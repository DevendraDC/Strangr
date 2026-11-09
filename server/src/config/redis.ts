import Redis from "ioredis";

export const client = new Redis();

client.on("connect", () => {
  console.log("Connected to Redis");
});

client.on("error", (error) => {
  console.error("Redis connection error:", error);
});
