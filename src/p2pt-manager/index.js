const Peer = window.SimplePeer;
const P2PT = window.P2PT;

class SimplePeerHandler {
	constructor({
		id,
		initiator,
		localName,
		localLocation,
		localMediaStream,
		sendSignal,
	}) {
		this.id = id;
		this.initiator = initiator;
		this.localName = localName;
		this.localLocation = localLocation;
		this.localMediaStream = localMediaStream;
		this.sendSignal = sendSignal;

		this._resetPeerState();
	}

	_resetPeerState = () => {
		this.peer = null;
		this.connected = false;
		this.name = null;
		this.stream = null;
		this.location = null;
	};

	connect = ({ onConnect, onDisconnect, onName, onLocation, onStream }) => {
		const { id, localMediaStream } = this;
		console.log(`_createPeer ${id}:`);

		const peer = new Peer({
			initiator: this.initiator,
			trickle: true,
			stream: localMediaStream,
		});

		peer.on("signal", (signal) => {
			const { id, sendSignal } = this;

			console.log(`signal ${id}`);
			console.log(signal);

			sendSignal(signal);
		});

		peer.on("connect", () => {
			console.log("peer connect");
			this.connected = true;
			onConnect();
			peer.send(JSON.stringify({ type: "name", name: this.localName }));
			peer.send(
				JSON.stringify({ type: "location", location: this.localLocation })
			);
		});

		peer.on("stream", (stream) => {
			console.log("peer stream");
			this.stream = stream;
			onStream(stream);
		});

		peer.on("track", (track) => {
			console.log("peer track");
		});

		peer.on("data", (payload) => {
			const data = JSON.parse(payload);
			switch (data.type) {
				case "location":
					this.location = data.location;
					onLocation(data.location);
					break;
				case "name":
					this.name = data.name;
					onName(data.name);
					break;
				default:
			}
		});

		const destroyPeer = (error) => {
			const { id } = this;

			if (error) {
				console.log(`destroyPeer ${id}: error ${error}`);
			} else {
				console.log(`destroyPeer ${id}:`);
			}

			this._resetPeerState();
			onDisconnect();
		};

		peer.on("error", destroyPeer);
		peer.on("close", destroyPeer);

		this.peer = peer;
	};

	disconnect = () => {
		this._resetPeerState();
	};

	receiveSignal = (signal) => {
		const { id, initiator, peer } = this;

		console.log(`signal : ${id}, ${initiator}`);
		console.log(signal);

		peer.signal(signal);
	};

	sendLocation = (location) => {
		const { peer, connected } = this;
		this.localLocation = location;
		if (connected) {
			peer.send(
				JSON.stringify({
					type: "location",
					location,
				})
			);
		}
	};
}

// Handles signaling through P2PT and peer discovery.
export class P2PTManager {
	constructor({ room, localName, localLocation, localStream }) {
		let announceURLs = [
			"wss://tracker.openwebtorrent.com",
			// Connections fail:
			// "wss://tracker.sloppyta.co:443/announce",
			// "wss://tracker.novage.com.ua:443/announce",
			// "wss://tracker.btorrent.xyz:443/announce"
		];

		this.p2pt = new P2PT(announceURLs, "webrtc-locality-" + room);
		this.localName = localName;
		this.localLocation = localLocation;
		this.localStream = localStream;
		this.peerHandlers = new Map();
		this.signalQueues = new Map();
	}

	setLocalName = (localName) => {
		this.localName = localName;
	};

	setLocalLocation = (localLocation) => {
		this.localLocation = localLocation;
	};

	setLocalStream = (localStream) => {
		this.localStream = localStream;
	};

	start = () => {
		const handleCreateAvatar = () => {};
		const handleDestroyAvatar = () => {};

		const { p2pt, peerHandlers, signalQueues } = this;

		this.p2pt.on("peerconnect", (signalingPeer) => {
			const { id } = signalingPeer;
			console.log(`peerconnect from ${id}`);

			const peerHandler = new SimplePeerHandler({
				id,
				initiator: signalingPeer.initiator,
				localName: this.localName,
				localLocation: this.localLocation,
				localMediaStream: this.localStream,
				sendSignal: (signal) => {
					p2pt.send(signalingPeer, { type: "signal", signal });
				},
			});
			signalQueues.get(id)?.forEach(peerHandler.signal);
			signalQueues.delete(id);
			peerHandlers.set(id, peerHandler);

			handleCreateAvatar(id, peerHandler);
		});

		this.p2pt.on("msg", ({ id }, msg) => {
			const peerHandler = peerHandlers.get(id);
			if (!peerHandler) {
				console.log(
					`peerHandler missing for id ${id} on msg with type ${msg.type}`
				);
				console.log(msg);
				let signalQueue = signalQueues.get(id);
				if (!signalQueue) {
					signalQueue = [];
					signalQueues.set(id, signalQueue);
				}

				if (msg.type === "signal") {
					signalQueue.push(msg.signal);
				}
			}

			if (msg.type === "signal") {
				peerHandler.receiveSignal(msg.signal);
			}
		});

		this.p2pt.on("peerclose", ({ id }) => {
			console.log(`peerclose from ${id}`);

			if (!peerHandlers.has(id)) {
				console.log(`peerHandler missing for peerclose on ${id}`);
			}

			peerHandlers.delete(id);
			signalQueues.delete(id);
			handleDestroyAvatar(id);
		});

		this.p2pt.start();
	};
}
