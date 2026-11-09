// import { useParams } from "react-router";

// export default function Room() {
//   const params = useParams();

//   console.log("Room component rendered:", params);

//   return (
//     <div className="min-h-screen bg-black text-white p-10">
//       <h1 className="text-3xl">Room Joined!</h1>
//       <p>Room ID: {params.id}</p>
//     </div>
//   );
// }
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

  if (mediaError) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-10">
        <div className="text-center flex flex-col gap-4">
          <p>{mediaError}</p>
          <button
            className="bg-white text-black p-2 cursor-pointer"
            onClick={handleStop}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col md:flex-row">
      {/* Video area */}
      <div className="relative flex-1 bg-neutral-900">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />

        {status !== "connected" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-xl">{statusLabel[status]}</p>
          </div>
        )}

        {/* Local preview */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-4 right-4 w-40 md:w-56 aspect-video object-cover rounded border border-white/30 bg-black -scale-x-100"
        />

        {/* Controls */}
        <div className="absolute bottom-4 left-4 flex gap-2">
          <button
            onClick={toggleMic}
            className="bg-white/90 text-black px-3 py-2 cursor-pointer"
          >
            {micOn ? "Mute" : "Unmute"}
          </button>
          <button
            onClick={toggleCam}
            className="bg-white/90 text-black px-3 py-2 cursor-pointer"
          >
            {camOn ? "Camera off" : "Camera on"}
          </button>
          <button
            onClick={handleNext}
            className="bg-blue-500 text-white px-3 py-2 cursor-pointer"
          >
            Next
          </button>
          <button
            onClick={handleStop}
            className="bg-red-500 text-white px-3 py-2 cursor-pointer"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Chat */}
      <div className="w-full md:w-80 h-64 md:h-full flex flex-col border-l border-white/10">
        <div className="p-3 text-sm text-white/60 border-b border-white/10">
          {statusLabel[status]}
          {rtcState && (
            <div className="text-xs text-white/40 mt-1 break-all">{rtcState}</div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] px-3 py-1 rounded text-sm break-words ${
                m.from === "me"
                  ? "self-end bg-blue-500"
                  : "self-start bg-white/10"
              }`}
            >
              {m.text}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form onSubmit={sendMessage} className="p-3 flex gap-2 border-t border-white/10">
          <input
            className="flex-1 bg-white/10 p-2 text-sm outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={status === "connected" ? "Type a message" : "Waiting..."}
            disabled={status !== "connected"}
            maxLength={500}
          />
          <button
            type="submit"
            disabled={status !== "connected"}
            className="bg-white text-black px-3 cursor-pointer disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}