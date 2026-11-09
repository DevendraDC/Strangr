// import { useSocket } from "~/providers/socketProvider";
// import type { Route } from "./+types/home";
// import { useEffect, useState } from "react";
// import { useNavigate } from "react-router";

// export function meta({ }: Route.MetaArgs) {
//   return [
//     { title: "New React Router App" },
//     { name: "description", content: "Welcome to React Router!" },
//   ];
// }

// export default function Home() {
//   const { socket } = useSocket()
//   const navigate = useNavigate()
//   const [username, setUsername] = useState("")
//   const [interest, setInterest] = useState("")
//   const handleJoin = (e: any) => {
//     e.preventDefault();
//     socket.emit("join", { username, interest });
//   }
//   useEffect(() => {
//     if(!socket) return;
//     socket.on("joined", ({roomId}: {roomId: string}) => navigate(`/room/${roomId}`))
//   }, [])
//   return (
//     <div className="flex justify-center items-center w-screen h-screen">
//       <div className="flex flex-col gap-10 bg-blue-400/20 p-6">
//         <input className="bg-white/10 p-2" value={username} onChange={(e) => setUsername(e.target.value)} type="text" name="usernane" id="username" placeholder="enter username" />
//         <input className="bg-white/10 p-2" value={interest} onChange={(e) => setInterest(e.target.value)} type="text" name="interest" id="interest" placeholder="enter interest" />
//         <button className="bg-white cursor-pointer text-black p-2" onClick={handleJoin}>start</button>
//       </div>
//     </div>
//   );
// }
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
      // Pass the profile along so the room page can use "Next".
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
    <div className="flex justify-center items-center w-screen h-screen">
      <form
        onSubmit={handleJoin}
        className="flex flex-col gap-6 bg-blue-400/20 p-6 w-80"
      >
        <input
          className="bg-white/10 p-2"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          type="text"
          name="username"
          id="username"
          placeholder="enter username"
          disabled={searching}
        />
        <input
          className="bg-white/10 p-2"
          value={interest}
          onChange={(e) => setInterest(e.target.value)}
          type="text"
          name="interest"
          id="interest"
          placeholder="enter interest (optional)"
          disabled={searching}
        />

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {searching ? (
          <>
            <p className="text-center">Looking for someone...</p>
            <button
              type="button"
              className="bg-red-500 text-white cursor-pointer p-2"
              onClick={handleCancel}
            >
              cancel
            </button>
          </>
        ) : (
          <button
            type="submit"
            className="bg-white cursor-pointer text-black p-2"
          >
            start
          </button>
        )}
      </form>
    </div>
  );
}