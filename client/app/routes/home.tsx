import { useSocket } from "~/providers/socketProvider";
import type { Route } from "./+types/home";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Random Video Chat" },
    { name: "description", content: "Talk to a random stranger" },
  ];
}

export default function Home() {
  const { socket } = useSocket();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [interest, setInterest] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim()) {
      setError("Please enter a username");
      return;
    }

    setError(null);
    socket.emit("join", { username: username.trim(), interest });
  };

  const handleCancel = () => {
    socket.emit("leave-room"); // also removes us from the waiting queue
    setSearching(false);
  };

  // Landing on the home page (including via browser back from a room)
  // means we are not in any room or queue. This is idempotent, so it is
  // safe under StrictMode's double mount.
  useEffect(() => {
    socket.emit("leave-room");
  }, [socket]);

  useEffect(() => {
    const onWaiting = () => setSearching(true);

    const onJoined = ({ roomId }: { roomId: string }) => {
      navigate(`/room/${roomId}`, {
        state: { username: username.trim(), interest },
      });
    };

    const onError = ({ message }: { message: string }) => {
      setSearching(false);
      setError(message);
    };

    socket.on("waiting", onWaiting);
    socket.on("joined", onJoined);
    socket.on("match-error", onError);

    return () => {
      socket.off("waiting", onWaiting);
      socket.off("joined", onJoined);
      socket.off("match-error", onError);
    };
  }, [socket, navigate, username, interest]);

  return (
    <div
      className="relative min-h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 flex items-center justify-center p-4"
      style={{ colorScheme: "dark" }}
    >
      {/* Background glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-fuchsia-600/10 blur-3xl" />

      <form
        onSubmit={handleJoin}
        className="relative w-full max-w-sm flex flex-col gap-5 rounded-2xl border border-white/10 bg-zinc-900/70 p-7 shadow-2xl backdrop-blur"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Meet someone new</h1>
          <p className="text-sm text-zinc-400">
            Random video chat with people who share your interests.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <input
            className="w-full rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            type="text"
            name="username"
            id="username"
            placeholder="Username"
            disabled={searching}
            maxLength={30}
          />
          <input
            className="w-full rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            type="text"
            name="interest"
            id="interest"
            placeholder="Interest (optional, e.g. anime)"
            disabled={searching}
            maxLength={30}
          />
        </div>

        {error && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        {searching ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-center gap-3 rounded-lg bg-zinc-950/60 py-3 text-sm text-zinc-300">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              Looking for someone...
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="cursor-pointer rounded-lg border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="submit"
            className="cursor-pointer rounded-lg bg-indigo-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 active:scale-[0.99]"
          >
            Start chatting
          </button>
        )}
      </form>
    </div>
  );
}