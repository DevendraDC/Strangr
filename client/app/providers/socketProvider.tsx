import { createContext, useContext, useMemo, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

interface SocketContextType {
    socket: Socket;
}

const SocketContext = createContext<SocketContextType | null>(null);

export const useSocket = () => {
    const context = useContext(SocketContext);

    if (!context) {
        throw new Error("useSocket must be used inside SocketProvider");
    }

    return context;
}

export const SocketProvider = ({ children }: { children: ReactNode }) => {
    const socket = useMemo(() => io("http://localhost:5001"), [])
    return (
        <SocketContext.Provider value={{ socket }}>
            {children}
        </SocketContext.Provider>
    )
}
