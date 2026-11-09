import { createContext, useContext, useMemo, type ReactNode } from "react";


interface PeerContextType {
    peer: RTCPeerConnection;
    createOffer: () => Promise<RTCSessionDescriptionInit>
}

const PeerContext = createContext<PeerContextType | null>(null);

export const usePeer = () => useContext(PeerContext)

export const PeerProvider = ({ children }: { children: ReactNode }) => {
    const peer = useMemo(() => new RTCPeerConnection({
        iceServers: [
            {
                urls: [
                    "stun:stun.l.google.com:19302",
                    "stun:global.stun.twilio.com:3478"
                ]
            }
        ]
    }), [])

    const createOffer = async () => {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        return offer;
    }
    return (
        <PeerContext.Provider value={{ peer, createOffer }}>
            {children}
        </PeerContext.Provider>
    )
}