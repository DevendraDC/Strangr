import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useSocket } from "~/providers/socketProvider";

type Status = "connecting" | "connected" | "searching" | "partner-left";
type ChatMsg = { from: "me" | "stranger"; text: string };
type Profile = { username: string; interest: string };

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:global.stun.twilio.com:3478",
      ],
    },
    // For users behind strict NATs you will need a TURN server, e.g.:
    // { urls: "turn:your.turn.server:3478", username: "...", credential: "..." },
  ],
};

// -----------------------------
// Small inline icons
// -----------------------------
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const MicIcon = () => (
  <Icon>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </Icon>
);

const MicOffIcon = () => (
  <Icon>
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </Icon>
);

const CamIcon = () => (
  <Icon>
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </Icon>
);

const CamOffIcon = () => (
  <Icon>
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </Icon>
);

const SkipIcon = () => (
  <Icon>
    <polygon points="5 4 15 12 5 20 5 4" />
    <line x1="19" y1="5" x2="19" y2="19" />
  </Icon>
);

const StopIcon = () => (
  <Icon>
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="23" y1="1" x2="1" y2="23" />
  </Icon>
);

export default function Room() {
  const { id: roomId } = useParams();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const profile = (location.state as Profile | null) ?? null;

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [localReady, setLocalReady] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [rtcState, setRtcState] = useState("");

  // If someone opens /room/xyz directly (refresh, shared link) there is no
  // profile and the server has no record of them in that room. Send them home.
  useEffect(() => {
    if (!profile) navigate("/", { replace: true });
  }, [profile, navigate]);

  // -----------------------------
  // 1. Camera + microphone (once)
  // -----------------------------
  useEffect(() => {
    if (!profile) return;

    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        // Handles React StrictMode's mount -> unmount -> mount in dev.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setLocalReady(true);
      })
      .catch((err) => {
        console.error("getUserMedia failed:", err);
        setMediaError(
          "Could not access your camera/microphone. Allow permissions and reload."
        );
      });

    return () => {
      cancelled = true;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalReady(false);
    };
  }, [profile]);

  // -----------------------------
  // 2. Matchmaking events while inside the room page
  //    (used by the "Next" button)
  // -----------------------------
  useEffect(() => {
    const onWaiting = () => setStatus("searching");

    const onJoined = ({ roomId: newRoomId }: { roomId: string }) => {
      navigate(`/room/${newRoomId}`, { replace: true, state: profile });
    };

    socket.on("waiting", onWaiting);
    socket.on("joined", onJoined);

    return () => {
      socket.off("waiting", onWaiting);
      socket.off("joined", onJoined);
    };
  }, [socket, navigate, profile]);

  // -----------------------------
  // 3. WebRTC connection, one per room
  // -----------------------------
  useEffect(() => {
    if (!roomId || !localReady || !localStreamRef.current) return;

    setStatus("connecting");
    setMessages([]);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    let remoteDescriptionSet = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    localStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", { roomId, candidate: event.candidate });
      }
    };

    const refreshRtcState = () => {
      console.log(
        "[rtc]",
        "conn:", pc.connectionState,
        "ice:", pc.iceConnectionState,
        "signaling:", pc.signalingState
      );
      setRtcState(
        `conn=${pc.connectionState} ice=${pc.iceConnectionState} sig=${pc.signalingState}`
      );
      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        setStatus("connected");
      }
    };

    pc.onconnectionstatechange = refreshRtcState;
    pc.oniceconnectionstatechange = refreshRtcState;
    pc.onsignalingstatechange = refreshRtcState;

    // ICE candidates can arrive before the remote description is set.
    // Buffer them and apply once it is.
    const flushCandidates = async () => {
      for (const c of pendingCandidates) {
        try {
          await pc.addIceCandidate(c);
        } catch (err) {
          console.error("addIceCandidate failed:", err);
        }
      }
      pendingCandidates.length = 0;
    };

    const onBothReady = async ({ initiator }: { initiator: boolean }) => {
      console.log("[signal] both-ready, initiator =", initiator);
      if (!initiator) return; // the other side waits for our offer
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { roomId, offer });
      } catch (err) {
        console.error("createOffer failed:", err);
      }
    };

    const onOffer = async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
      console.log("[signal] received offer");
      try {
        await pc.setRemoteDescription(offer);
        remoteDescriptionSet = true;
        await flushCandidates();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", { roomId, answer });
      } catch (err) {
        console.error("handling offer failed:", err);
      }
    };

    const onAnswer = async ({
      answer,
    }: {
      answer: RTCSessionDescriptionInit;
    }) => {
      try {
        await pc.setRemoteDescription(answer);
        remoteDescriptionSet = true;
        await flushCandidates();
      } catch (err) {
        console.error("handling answer failed:", err);
      }
    };

    const onIceCandidate = async ({
      candidate,
    }: {
      candidate: RTCIceCandidateInit;
    }) => {
      if (!remoteDescriptionSet) {
        pendingCandidates.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error("addIceCandidate failed:", err);
      }
    };

    const onChatMessage = ({ message }: { message: string }) => {
      setMessages((prev) => [...prev, { from: "stranger", text: message }]);
    };

    const onPartnerLeft = () => {
      pc.close();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setStatus("partner-left");
    };

    // Register every listener BEFORE telling the server we're ready,
    // so we can't miss the offer.
    socket.on("both-ready", onBothReady);
    socket.on("offer", onOffer);
    socket.on("answer", onAnswer);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("chat-message", onChatMessage);
    socket.on("partner-left", onPartnerLeft);

    console.log("[signal] emitting peer-ready for room", roomId);
    socket.emit("peer-ready", { roomId });

    return () => {
      socket.off("both-ready", onBothReady);
      socket.off("offer", onOffer);
      socket.off("answer", onAnswer);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("chat-message", onChatMessage);
      socket.off("partner-left", onPartnerLeft);

      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.close();
      if (pcRef.current === pc) pcRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
  }, [roomId, localReady, socket]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // -----------------------------
  // Actions
  // -----------------------------
  const handleNext = () => {
    if (!profile) return;

    pcRef.current?.close();
    pcRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    setMessages([]);
    setStatus("searching");

    // Server clears our state synchronously on leave-room, so the join
    // that follows is never rejected as a duplicate.
    socket.emit("leave-room");
    socket.emit("join", profile);
  };

  const handleStop = () => {
    socket.emit("leave-room");
    navigate("/");
  };

  const toggleMic = () => {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  };

  const toggleCam = () => {
    const next = !camOn;
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || status !== "connected" || !roomId) return;

    socket.emit("chat-message", { roomId, message: text });
    setMessages((prev) => [...prev, { from: "me", text }]);
    setDraft("");
  };

  const statusLabel: Record<Status, string> = {
    connecting: "Connecting to stranger...",
    connected: "Connected",
    searching: "Looking for someone to talk to...",
    "partner-left": "Stranger has disconnected",
  };

  const dotColor: Record<Status, string> = {
    connecting: "bg-amber-400",
    connected: "bg-emerald-400",
    searching: "bg-amber-400",
    "partner-left": "bg-red-400",
  };

  if (mediaError) {
    return (
      <div
        className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6"
        style={{ colorScheme: "dark" }}
      >
        <div className="max-w-sm text-center flex flex-col gap-4 rounded-2xl border border-white/10 bg-zinc-900 p-7">
          <p className="text-sm text-zinc-300">{mediaError}</p>
          <button
            className="cursor-pointer rounded-lg bg-indigo-500 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
            onClick={handleStop}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const ctrlBase =
    "flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition active:scale-95";

  return (
    <div
      className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col md:flex-row gap-3 p-3"
      style={{ colorScheme: "dark" }}
    >
      {/* Video area */}
      <div className="relative flex-1 min-h-0 overflow-hidden rounded-2xl border border-white/5 bg-zinc-900">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />

        {status !== "connected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/80 backdrop-blur-sm">
            {status !== "partner-left" && (
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            )}
            <p className="text-base text-zinc-300">{statusLabel[status]}</p>
            {status === "partner-left" && (
              <button
                onClick={handleNext}
                className="cursor-pointer rounded-lg bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400"
              >
                Find someone new
              </button>
            )}
          </div>
        )}

        {/* Local preview */}
        <div className="absolute right-3 top-3 w-32 md:w-48 overflow-hidden rounded-xl border border-white/15 bg-black shadow-xl">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="aspect-video w-full -scale-x-100 object-cover"
          />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 text-xs text-zinc-400">
              Camera off
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-zinc-900/80 p-2 shadow-xl backdrop-blur">
          <button
            onClick={toggleMic}
            title={micOn ? "Mute" : "Unmute"}
            className={`${ctrlBase} ${
              micOn
                ? "bg-white/10 text-zinc-100 hover:bg-white/20"
                : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
            }`}
          >
            {micOn ? <MicIcon /> : <MicOffIcon />}
          </button>
          <button
            onClick={toggleCam}
            title={camOn ? "Turn camera off" : "Turn camera on"}
            className={`${ctrlBase} ${
              camOn
                ? "bg-white/10 text-zinc-100 hover:bg-white/20"
                : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
            }`}
          >
            {camOn ? <CamIcon /> : <CamOffIcon />}
          </button>
          <button
            onClick={handleNext}
            title="Next stranger"
            className="flex h-11 cursor-pointer items-center gap-2 rounded-full bg-indigo-500 px-5 text-sm font-semibold text-white transition hover:bg-indigo-400 active:scale-95"
          >
            <SkipIcon />
            Next
          </button>
          <button
            onClick={handleStop}
            title="Stop"
            className={`${ctrlBase} bg-red-500 text-white hover:bg-red-400`}
          >
            <StopIcon />
          </button>
        </div>
      </div>

      {/* Chat */}
      <div className="flex h-64 w-full flex-col overflow-hidden rounded-2xl border border-white/5 bg-zinc-900 md:h-full md:w-80 lg:w-96">
        <div className="border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-zinc-200">
            <span className={`h-2 w-2 rounded-full ${dotColor[status]}`} />
            {statusLabel[status]}
          </div>
          {rtcState && (
            <div className="mt-1 break-all text-[11px] text-zinc-600">
              {rtcState}
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <p className="m-auto text-center text-sm text-zinc-600">
              {status === "connected"
                ? "Say hi 👋"
                : "Chat opens once you're connected"}
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] break-words rounded-2xl px-3 py-1.5 text-sm ${
                m.from === "me"
                  ? "self-end rounded-br-sm bg-indigo-500 text-white"
                  : "self-start rounded-bl-sm bg-zinc-800 text-zinc-100"
              }`}
            >
              {m.text}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form
          onSubmit={sendMessage}
          className="flex gap-2 border-t border-white/5 p-3"
        >
          <input
            className="flex-1 rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-40"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={status === "connected" ? "Type a message" : "Waiting..."}
            disabled={status !== "connected"}
            maxLength={500}
          />
          <button
            type="submit"
            disabled={status !== "connected"}
            className="cursor-pointer rounded-lg bg-indigo-500 px-4 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}