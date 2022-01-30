import cx from "clsx";
import React from "react";
import {
	animated,
	config as springConfig,
	useSpring,
	useTransition,
} from "react-spring";
import { useImmer } from "use-immer";
import styles from "./App.module.css";
import { useMediaStream, useViewport } from "./hooks";

const Peer = window.SimplePeer;
const P2PT = window.P2PT;

function Avatars({ children }) {
	return (
		<div className={[styles.Avatars]} style={{ pointerEvents: "none" }}>
			{children}
		</div>
	);
}

function Avatar({
	listenerLocation,
	name,
	mediaStream,
	location = [0, 0],
	muted,
}) {
	const [playing, setPlaying] = React.useState(false);
	const videoRef = React.useRef(null);

	const videoRefFunc = React.useCallback(
		(/** @type HTMLMediaElement */ ref) => {
			videoRef.current = ref;
			if (ref) {
				ref.srcObject = mediaStream;
				ref.play();
				setTimeout(() => setPlaying(true), 0); // TODO: mount check?
			}
		},
		[mediaStream]
	);

	const volume = React.useMemo(() => {
		if (muted) {
			return 0;
		}

		const l = location;
		const m = listenerLocation;
		const d = Math.sqrt(Math.pow(m[0] - l[0], 2) + Math.pow(m[1] - l[1], 2));
		const v = Math.min(
			Math.max(
				Math.pow(1 - d / document.documentElement.clientWidth, 2.0),
				0.0
			),
			1.0
		);
		return v;
	}, [muted, location, listenerLocation]);

	React.useEffect(() => {
		if (videoRef.current) {
			videoRef.current.volume = volume;
		}
	}, [volume]);

	const springStyles = useSpring({
		transform: `translate3d(${location[0]}px, ${location[1]}px, 0) translate3d(-50%, -50%, 0)`,
		config: springConfig.stiff,
	});

	return (
		<animated.div
			className={cx(styles.Avatar, playing && styles.avatarVideo)}
			style={springStyles}
		>
			<div className={styles.avatarInset}>
				<video ref={videoRefFunc} muted={!!muted} autoPlay playsInline />
				<div className={styles.avatarVolume}>
					{name} {Math.ceil(volume * 100)}
				</div>
			</div>
		</animated.div>
	);
}

function PeerAvatar({ peerHandler, listenerLocation }) {
	const [name, setName] = React.useState("");
	const [mediaStream, setMediaStream] = React.useState(null);
	const [location, setLocation] = React.useState(() => {
		// Randomly outside grid?
		return [
			Math.random() * document.documentElement.clientWidth,
			Math.random() * document.documentElement.clientHeight,
		];
	});

	React.useEffect(() => {
		peerHandler.connect({
			onConnect: () => {},
			onDisconnect: () => {},
			onName: setName,
			onStream: setMediaStream,
			onLocation: setLocation,
		});

		return () => {
			peerHandler.disconnect();
		};
	}, [peerHandler]);

	return (
		<Avatar
			listenerLocation={listenerLocation}
			name={name}
			mediaStream={mediaStream}
			location={location}
		/>
	);
}

class PeerHandler {
	constructor({
		id,
		initiator,
		localName,
		localLocation,
		localMediaStream,
		log,
		onSignal,
	}) {
		this.id = id;
		this.initiator = initiator;
		this.localName = localName;
		this.localLocation = localLocation;
		this.localMediaStream = localMediaStream;
		this.log = log;
		this.onSignal = onSignal;

		this._resetPeerState();
	}

	_resetPeerState() {
		this.peer = null;
		this.connected = false;
		this.name = null;
		this.stream = null;
		this.location = null;
	}

	connect({ onConnect, onDisconnect, onName, onLocation, onStream }) {
		const { id, localMediaStream } = this;
		this.log(`_createPeer ${id}:`);

		const peer = new Peer({
			initiator: this.initiator,
			trickle: true,
			stream: localMediaStream,
		});

		peer.on("signal", (signal) => {
			const { id, onSignal } = this;

			this.log(`signal ${id}`);
			console.log(signal);

			onSignal(signal);
		});

		peer.on("connect", () => {
			this.log("peer connect");
			this.connected = true;
			onConnect();
			peer.send(JSON.stringify({ type: "name", name: this.localName }));
			peer.send(
				JSON.stringify({ type: "location", location: this.locationLocation })
			);
		});

		peer.on("stream", (stream) => {
			this.log("peer stream");
			this.stream = stream;
			onStream(stream);
		});

		peer.on("track", (track) => {
			this.log("peer track");
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
				this.log(`destroyPeer ${id}: error ${error}`);
			} else {
				this.log(`destroyPeer ${id}:`);
			}

			this._resetPeerState();
			onDisconnect();
		};

		peer.on("error", destroyPeer);
		peer.on("close", destroyPeer);

		this.peer = peer;
	}

	disconnect() {
		this._resetPeerState();
	}

	signal(signal) {
		const { id, initiator, peer } = this;

		this.log(`signal : ${id}, ${initiator}`);
		console.log(signal);

		peer.signal(signal);
	}

	sendLocation(location) {
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
	}
}

function HUD({ children, onChooseLocation }) {
	return (
		<div className={styles.HUD}>
			<div
				className={styles.hudLocator}
				onClick={(e) =>
					console.log("click", e.clientX) ||
					onChooseLocation([e.clientX, e.clientY])
				}
			/>
			{children}
		</div>
	);
}

const JoinForm = ({ style, disabled, onJoin }) => {
	const [name, setName] = React.useState("");

	return (
		<div className={styles.JoinForm} style={style}>
			<div className={styles.joinField}>
				<input
					placeholder="Name"
					type="text"
					disabled={disabled}
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>
			<div>
				<button type="button" disabled={disabled} onClick={() => onJoin(name)}>
					Join
				</button>
			</div>
		</div>
	);
};

const AnimatedJoinForm = animated(JoinForm);

export default function App() {
	const [log, setLog] = React.useState([]);
	const logit = React.useCallback((entry) => {
		console.log(entry);
		setLog((l) => [...l, JSON.stringify(entry, undefined, 2)]);
	}, []);

	const [peerTracker, setPeerTracker] = React.useState(null);
	const [localName, setLocalName] = React.useState(null);

	/*
	React.useEffect(() => {
		const interval = setInterval(() => {
			if (peerTracker) {
				logit("requesting more peers");
				peerTracker.requestMorePeers();
			}
		}, 3000);

		return () => {
			clearInterval(interval);
		};
	}, [peerTracker, logit]);
	*/

	const viewport = useViewport();

	const [location, setLocation] = React.useState(() => [
		viewport.width / 2,
		viewport.height / 2,
	]);

	const { mediaStream, error: mediaError } = useMediaStream({
		video: true,
		audio: true,
	});

	const [avatars, updateAvatars] = useImmer({});

	const handleCreateAvatar = React.useCallback(
		(id, peerHandler) => {
			updateAvatars((draftAvatars) => {
				draftAvatars[id] = {
					id,
					peerHandler,
				};
			});
		},
		[updateAvatars]
	);

	const handleDestroyAvatar = React.useCallback(
		(id) => {
			updateAvatars((draftAvatars) => {
				delete draftAvatars[id];
			});
		},
		[updateAvatars]
	);

	const handleJoin = React.useCallback(
		(joinName, joinLocation, joinStream) => {
			setLocalName(joinName);

			const room = window.location.hash || "general";

			let announceURLs = [
				"wss://tracker.openwebtorrent.com",
				// Connections fail:
				// "wss://tracker.sloppyta.co:443/announce",
				// "wss://tracker.novage.com.ua:443/announce",
				// "wss://tracker.btorrent.xyz:443/announce"
			];

			const p2pt = new P2PT(announceURLs, "webrtc-locality-" + room);
			const peerHandlers = new Map();
			const signalQueues = new Map();

			p2pt.on("peerconnect", (signalingPeer) => {
				const { id } = signalingPeer;
				logit(`peerconnect from ${id}`);

				const peerHandler = new PeerHandler({
					id,
					initiator: signalingPeer.initiator,
					localName: joinName,
					localLocation: joinLocation,
					localMediaStream: joinStream,
					log: logit,
					onSignal: (signal) => {
						p2pt.send(signalingPeer, { type: "signal", signal });
					},
				});
				signalQueues.get(id)?.forEach(peerHandler.signal);
				signalQueues.delete(id);
				peerHandlers.set(id, peerHandler);

				handleCreateAvatar(id, peerHandler);
			});

			p2pt.on("msg", ({ id }, msg) => {
				const peerHandler = peerHandlers.get(id);
				if (!peerHandler) {
					logit(
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
					peerHandler.signal(msg.signal);
				}
			});

			p2pt.on("peerclose", ({ id }) => {
				logit(`peerclose from ${id}`);

				if (!peerHandlers.has(id)) {
					logit(`peerHandler missing for peerclose on ${id}`);
				}

				peerHandlers.delete(id);
				signalQueues.delete(id);
				handleDestroyAvatar(id);
			});

			p2pt.start();

			setPeerTracker(p2pt);
		},
		[handleCreateAvatar, handleDestroyAvatar, logit]
	);

	const handleChooseLocation = (location) => {
		setLocation(location);
	};

	React.useEffect(() => {
		Object.values(avatars).forEach((avatar) => {
			console.log(avatar.peerHandler);
			avatar.peerHandler.sendLocation(location);
		});
	}, [avatars, location]);

	const transitions = useTransition(!peerTracker, {
		enter: {
			opacity: 1,
		},
		leave: {
			opacity: 0,
		},
	});

	const logRef = React.useRef(null);
	React.useEffect(() => {
		const el = logRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [log]);

	if (mediaError) {
		return (
			<div>
				Media Permissions
				<br />
				{mediaError.toString()}
			</div>
		);
	}

	return (
		<>
			<div
				ref={logRef}
				style={{
					position: "absolute",
					inset: 0,
					overflow: "scroll",
					paddingLeft: "1em",
					fontSize: "50%",
				}}
			>
				Log:
				{log.map((entry, i) => (
					<div key={i}>{entry}</div>
				))}
			</div>

			<HUD onChooseLocation={handleChooseLocation}></HUD>
			<Avatars>
				{Object.values(avatars).map((avatar) => (
					<PeerAvatar
						key={avatar.id}
						peerHandler={avatar.peerHandler}
						listenerLocation={location}
					/>
				))}

				<Avatar
					listenerLocation={location}
					name={localName}
					mediaStream={mediaStream}
					location={location}
					muted
				/>
			</Avatars>
			{transitions(
				(stylez, item) =>
					item && (
						<AnimatedJoinForm
							style={{ opacity: stylez.opacity }}
							disabled={!!peerTracker}
							onJoin={(name) => handleJoin(name, location, mediaStream)}
						/>
					)
			)}
		</>
	);
}
