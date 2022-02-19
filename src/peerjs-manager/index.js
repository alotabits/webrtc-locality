import produce from "immer";
import Peer from "peerjs";

export const actions = {
	setLocation: (location) => ({
		type: "location",
		location,
	}),

	setName: (name) => ({
		type: "name",
		name,
	}),

	setMediaStream: (mediaStream) => ({
		type: "mediaStream",
		mediaStream,
	}),

	sync: (sync) => ({
		type: "sync",
		sync,
	}),

	discover: (discover) => ({
		type: "discover",
		discover,
	}),
};

const peerReducerInit = {
	name: "",
	location: [
		Math.random() * document.documentElement.clientWidth,
		Math.random() * document.documentElement.clientHeight,
	],
	mediaStream: null,
};

const peerReducer = produce((draft, action) => {
	switch (action.type) {
		case "location":
		case "name":
		case "mediaStream":
			draft[action.type] = action[action.type];
			break;
		case "sync":
			if (!draft) {
				return action.sync;
			}
			Object.assign(draft, action.sync);
			break;
		default:
			return draft;
	}
});

export class PeerJSHandler {
	constructor(remoteId) {
		this.remoteId = remoteId;
		this.peerState = peerReducerInit;
		this.dataConn = null;
		this.mediaConn = null;
	}

	attach = ({ onPeerState }) => {
		this.onPeerState = onPeerState;
		this.onPeerState?.(this.peerState);
	};

	detach = () => {
		this.onPeerState = null;
	};

	send = (action) => {
		if (this.dataConn?.open) {
			this.dataConn.send(action);
		}
	};

	setDataConnection = (dataConn, onDiscover) => {
		this.dataConn = dataConn;
		dataConn.on("open", () => {
			console.log("PeerJSHandler: peer data connection open event");

			dataConn.on("data", (data) => {
				if (data.type === "discover") {
					console.log(data);
					onDiscover(data.discover);
					return;
				}
				console.log("PeerJSHandler: peer data connection data event");
				this.peerState = peerReducer(this.peerState, data);
				this.onPeerState?.(this.peerState);
			});
		});
	};

	setMediaConnection = (mediaConn) => {
		this.mediaConn = mediaConn;
		mediaConn.on("stream", (peerMediaStream) => {
			console.log("PeerJSHandler: peer media stream event");
			this.peerState = peerReducer(
				this.peerState,
				actions.setMediaStream(peerMediaStream)
			);
			this.onPeerState?.(this.peerState);
		});
	};
}

// Handles signaling through PeerJS without peer discovery.
export class PeerJSManager {
	constructor() {
		this.localState = peerReducerInit;
		this.peerHandlers = new Map();
	}

	_getPeer = (id) => {
		let peerHandler = this.peerHandlers.get(id);
		if (!peerHandler) {
			peerHandler = new PeerJSHandler(id);
			this.peerHandlers.set(id, peerHandler);
		}
		return peerHandler;
	};

	_discover = (peers) => {
		peers.forEach((peer) => {
			this.connect(peer.id);
		});
	};

	dispatch = (action) => {
		this.localState = peerReducer(this.localState, action);
		if (action.type !== "mediaStream") {
			this.peerHandlers.forEach((peerHandler) => {
				peerHandler.send(action);
			});
		}
		return this.localState;
	};

	getLocalState = () => {
		return this.localState;
	};

	start = ({ onOpen, onPeerConnect, onPeerDisconnect, onFatal }) => {
		this.onOpen = onOpen;
		this.onPeerConnect = onPeerConnect;
		this.onPeerDisconnect = onPeerDisconnect;
		this.onFatal = onFatal;

		this.peer = new Peer();

		this.peer.on("open", (id) => {
			this.id = id;
			this.onOpen?.(id);
			navigator.clipboard.writeText(id);
		});

		this.peer.on("connection", (dataConn) => {
			console.log("PeerJSManager: received peer data connection");

			const peerHandler = this._getPeer(dataConn.peer);
			peerHandler.setDataConnection(dataConn, this._discover);

			dataConn.on("open", () => {
				const { mediaStream: discard, ...sync } = this.localState;
				dataConn.send(actions.sync(sync));
				dataConn.send(
					actions.discover(
						Array.from(this.peerHandlers, ([name, value]) => ({
							id: value.remoteId,
						}))
					)
				);
				this.onPeerConnect?.(dataConn.peer, peerHandler);
			});

			dataConn.on("close", () => {
				this.onPeerDisconnect?.(dataConn.peer);
			});
		});

		this.peer.on("call", (mediaConn) => {
			console.log("PeerJSManager: received peer media connection");

			mediaConn.answer(this.localState.mediaStream);
			const peerHandler = this._getPeer(mediaConn.peer);
			peerHandler.setMediaConnection(mediaConn);
		});

		this.peer.on("close", () => {
			console.log("PeerJSManager: peer connection closed.");
			this.peer.destroy();
			this.onFatal?.();
		});

		this.peer.on("disconnected", () => {
			console.log("PeerJSManager: peer disconnected.");
			this.peer.reconnect();
			// Should keep track of..what?
		});

		this.peer.on("error", (error) => {
			switch (error.type) {
				case "browser-incompatible":
				case "invalid-id":
				case "invalid-key":
				case "ssl-unavailable":
				case "server-error":
				case "socket-closed":
					// TODO: Fatal
					// TODO: Let parent know;
					console.log("PeerJSManaer: fatal error received", error);
					break;
				default:
					console.log("PeerJSManaer: non-fatal error received", error);
			}
		});
	};

	connect = (remoteId) => {
		if (remoteId === this.id) {
			console.log(`PeerJSManager: skipping connect to self at ${remoteId}`);
			return;
		}

		if (this.peerHandlers.has(remoteId)) {
			console.log(`PeerJSManager: already connected to ${remoteId}`);
			return;
		}

		console.log(`PeerJSManager: connecting to ${remoteId}`);
		const peerHandler = this._getPeer(remoteId);

		const dataConn = this.peer.connect(remoteId, {
			reliable: true,
			serialization: "json",
		});

		dataConn.on("open", () => {
			const { mediaStream: discard, ...sync } = this.localState;
			dataConn.send(actions.sync(sync));
			this.onPeerConnect?.(dataConn.peer, peerHandler);
		});

		dataConn.on("close", () => {
			this.onPeerDisconnect?.(dataConn.peer);
		});

		const mediaConn = this.peer.call(remoteId, this.localState.mediaStream);

		peerHandler.setDataConnection(dataConn, this._discover);
		peerHandler.setMediaConnection(mediaConn);
	};
}
