// import "dotenv/config";
// import express from "express";
// import cors from "cors";
// import { Server } from "socket.io";
// import { randomUUID } from "node:crypto";
// import { client } from "./config/redis";

// type DataType = {
//   username: string;
//   interest: string;
// };

// const app = express();

// app.use(cors());
// app.use(express.json());

// const io = new Server({
//   cors: {
//     origin: "http://localhost:5173",
//     methods: ["GET", "POST"],
//     credentials: true,
//   },
// });

// io.on("connection", (socket) => {
//   socket.on("join", async (data: DataType) => {
//     try {
//       const { username, interest } = data;

//       const intrst = interest.trim().toLowerCase();

//       const queueName =
//         intrst === "" ? "matchmaking:all" : `matchmaking:${intrst}`;

//       socket.data.username = username;
//       socket.data.interest = intrst;

//       let partnerSocket;

//       while (true) {
//         const partnerId = await client.lpop(queueName);

//         if (!partnerId) break;

//         const candidate = io.sockets.sockets.get(partnerId);

//         if (candidate && candidate.id !== socket.id) {
//           partnerSocket = candidate;
//           break;
//         }
//       }

//       if (!partnerSocket) {
//         await client.rpush(queueName, socket.id);

//         socket.data.queueName = queueName;

//         socket.emit("waiting");

//         return;
//       }

//       const roomId = randomUUID();

//       await socket.join(roomId);
//       await partnerSocket.join(roomId);

//       io.to(roomId).emit("joined", {
//         roomId,
//         interest: intrst,
//       });

//       console.log(`${username} matched with ${partnerSocket.data.username}`);

//       console.log("Room ID:", roomId);
//     } catch (error) {
//       console.error("Matchmaking error:", error);
//       socket.emit("match-error", {
//         message: "Something went wrong during matchmaking",
//       });
//     }
//   });

//   socket.on("disconnect", async () => {
//     const queueName = socket.data.queueName;

//     if (queueName) {
//       await client.lrem(queueName, 0, socket.id);
//     }

//     console.log("Disconnected:", socket.id);
//   });
// });

// app.listen(5000, () => {
//   console.log("Express server running on port 5000");
// });

// io.listen(5001);

import "dotenv/config";
import express from "express";
import cors from "cors";
import { Server, type Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { client } from "./config/redis";

type JoinData = {
  username: string;
  interest: string;
};

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const app = express();

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const io = new Server({
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Returns the live Socket objects currently in a room.
function getRoomSockets(roomId: string): Socket[] {
  const ids = io.sockets.adapter.rooms.get(roomId);
  if (!ids) return [];

  const sockets: Socket[] = [];
  for (const id of ids) {
    const s = io.sockets.sockets.get(id);
    if (s) sockets.push(s);
  }
  return sockets;
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // -----------------------------
  // MATCHMAKING
  // -----------------------------

  socket.on("join", async (data: JoinData) => {
    try {
      const username = String(data?.username ?? "").trim().slice(0, 30);
      const intrst = String(data?.interest ?? "").trim().toLowerCase().slice(0, 30);

      if (!username) {
        socket.emit("match-error", { message: "Username is required" });
        return;
      }

      // Prevent duplicate matchmaking requests.
      if (socket.data.roomId || socket.data.queueName) {
        return;
      }

      const queueName =
        intrst === "" ? "matchmaking:all" : `matchmaking:${intrst}`;

      socket.data.username = username;
      socket.data.interest = intrst;

      let partnerSocket: Socket | undefined;

      while (true) {
        const partnerId = await client.lpop(queueName);

        if (!partnerId) break;

        const candidate = io.sockets.sockets.get(partnerId);

        if (
          candidate &&
          candidate.id !== socket.id &&
          !candidate.data.roomId
        ) {
          delete candidate.data.queueName;
          partnerSocket = candidate;
          break;
        }
      }

      // The user may have left/disconnected while we were awaiting Redis.
      if (!socket.connected) {
        if (partnerSocket) {
          // Put the partner back at the front of the queue.
          await client.lpush(queueName, partnerSocket.id);
          partnerSocket.data.queueName = queueName;
        }
        return;
      }

      // Nobody available. Put current user in queue.
      if (!partnerSocket) {
        await client.rpush(queueName, socket.id);
        socket.data.queueName = queueName;
        socket.emit("waiting");
        return;
      }

      // -----------------------------
      // CREATE ROOM
      // -----------------------------

      const roomId = randomUUID();

      socket.data.roomId = roomId;
      partnerSocket.data.roomId = roomId;

      // Newly arrived user is the initiator (creates the offer).
      socket.data.initiator = true;
      partnerSocket.data.initiator = false;

      socket.data.peerReady = false;
      partnerSocket.data.peerReady = false;

      await socket.join(roomId);
      await partnerSocket.join(roomId);

      socket.emit("joined", {
        roomId,
        remoteSocketId: partnerSocket.id,
        initiator: true,
      });

      partnerSocket.emit("joined", {
        roomId,
        remoteSocketId: socket.id,
        initiator: false,
      });

      console.log(`${username} matched with ${partnerSocket.data.username}`);
      console.log("Room ID:", roomId);
    } catch (error) {
      console.error("Matchmaking error:", error);

      socket.emit("match-error", {
        message: "Something went wrong during matchmaking",
      });
    }
  });

  // -----------------------------
  // WEBRTC READY HANDSHAKE
  // -----------------------------

  socket.on("peer-ready", ({ roomId }: { roomId: string }) => {
    if (!roomId || socket.data.roomId !== roomId) return;

    socket.data.peerReady = true;

    const roomSockets = getRoomSockets(roomId);
    console.log(
      `peer-ready from ${socket.id}; room has ${roomSockets.length} sockets, ready: ${roomSockets.filter((s) => s.data.peerReady).length}`
    );

    // Wait until both users are ready.
    if (roomSockets.length !== 2) return;
    if (!roomSockets.every((s) => s.data.peerReady)) return;

    // Only the initiator creates the offer.
    for (const s of roomSockets) {
      s.emit("both-ready", { initiator: s.data.initiator });
    }
  });

  // -----------------------------
  // SIGNALING RELAY
  // -----------------------------

  socket.on("offer", ({ roomId, offer }) => {
    if (socket.data.roomId !== roomId) return;
    socket.to(roomId).emit("offer", { offer });
  });

  socket.on("answer", ({ roomId, answer }) => {
    if (socket.data.roomId !== roomId) return;
    socket.to(roomId).emit("answer", { answer });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    if (socket.data.roomId !== roomId) return;
    socket.to(roomId).emit("ice-candidate", { candidate });
  });

  // -----------------------------
  // TEXT CHAT
  // -----------------------------

  socket.on("chat-message", ({ roomId, message }) => {
    if (socket.data.roomId !== roomId) return;

    const text = String(message ?? "").trim().slice(0, 500);
    if (!text) return;

    socket.to(roomId).emit("chat-message", { message: text });
  });

  // -----------------------------
  // LEAVE / DISCONNECT
  // -----------------------------

  socket.on("leave-room", async () => {
    await cleanupSocket(socket);
  });

  socket.on("disconnect", async () => {
    await cleanupSocket(socket);
    console.log("Disconnected:", socket.id);
  });
});

// -----------------------------
// CLEANUP
// -----------------------------

function resetRoomState(s: Socket) {
  delete s.data.roomId;
  delete s.data.initiator;
  delete s.data.peerReady;
}

async function cleanupSocket(socket: Socket) {
  // Read and clear state synchronously, BEFORE any await. Otherwise a
  // "join" sent right after "leave-room" (the Next button) can race with
  // this cleanup and be ignored by the duplicate-request guard.
  const queueName: string | undefined = socket.data.queueName;
  const roomId: string | undefined = socket.data.roomId;

  delete socket.data.queueName;
  resetRoomState(socket);

  try {
    if (queueName) {
      await client.lrem(queueName, 0, socket.id);
    }

    if (roomId) {
      // Tell the partner and free them from the room too, so they can
      // immediately search again.
      for (const other of getRoomSockets(roomId)) {
        if (other.id === socket.id) continue;
        other.emit("partner-left");
        resetRoomState(other);
        other.leave(roomId);
      }

      socket.leave(roomId);
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}

// -----------------------------
// START SERVERS
// -----------------------------

app.listen(5000, () => {
  console.log("Express server running on port 5000");
});

io.listen(5001);

console.log("Socket.IO server running on port 5001");