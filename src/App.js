import { v4 as secureUUID } from "@lukeed/uuid/secure";
import cx from "clsx";
import React from "react";
import {
	animated,
	config as springConfig,
	useSpring,
	useTransition,
} from "react-spring";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { useEffect } from "react/cjs/react.development";
import { useImmer } from "use-immer";
import styles from "./App.module.css";
import { useMediaStream } from "./hooks";

const Peer = window.SimplePeer;
const P2PT = window.P2PT;

const AvatarContext = React.createContext({
	audioContext: null,
});

const avatarRadius = 170 / 2;
const worldWidth = 1920;
const worldHeight = 1080;

function Avatars({ audioContext, audioDestination, children }) {
	const contextValue = React.useMemo(() => {
		return { audioContext, audioDestination };
	}, [audioContext, audioDestination]);

	return (
		<AvatarContext.Provider value={contextValue}>
			<div className={[styles.Avatars]} style={{ pointerEvents: "none" }}>
				{children}
			</div>
		</AvatarContext.Provider>
	);
}

function Avatar({
	listenerLocation,
	name,
	mediaStream,
	location,
	muted,
	mirror,
}) {
	const [playing, setPlaying] = React.useState(false);
	const videoRef = React.useRef(null);

	const volume = React.useMemo(() => {
		if (muted) {
			return 0;
		}

		const l = location;
		const m = listenerLocation;
		// Find the distance between the two circumfri of the avatars
		const d =
			Math.sqrt(Math.pow(m[0] - l[0], 2) + Math.pow(m[1] - l[1], 2)) -
			2 * avatarRadius;
		const i = Math.min(Math.max(1 - d / 400, 0), 1);
		return Math.pow(i, 2.0);
	}, [muted, location, listenerLocation]);

	const { audioContext, audioDestination } = React.useContext(AvatarContext);
	const gainRef = React.useRef({ value: 0, setValue: () => {} });

	useEffect(() => {
		if (!mediaStream) {
			gainRef.current.setValue = (gain) => {
				gainRef.current.value = gain;
				// For the spring style, not that it matters much.
				return gain;
			};
			return;
		}

		const gainNode = audioContext.createGain();
		gainNode.gain.value = gainRef.current.value;
		audioContext
			.createMediaStreamSource(mediaStream)
			.connect(gainNode)
			.connect(audioDestination);

		gainRef.current.setValue = (gain) => {
			console.log("Gain", gain);
			gainRef.current.value = gain;
			gainNode.gain.value = gain;
			// For the spring style, not that it matters much.
			return gain;
		};

		return () => {
			// TODO: Failed to execute 'disconnect' on 'AudioNode': the given destination is not connected.
			gainNode.disconnect(audioDestination);
		};
	}, [audioContext, audioDestination, mediaStream]);

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

	const springStyles = useSpring({
		volume,
		transform: `translate3d(${location[0]}px, ${location[1]}px, 0) translate3d(-50%, -50%, 0)`,
		config: springConfig.stiff,
	});

	return (
		<animated.div
			className={cx(styles.Avatar, playing && styles.avatarVideo)}
			style={{
				// Hacky, but works.
				"--volume": springStyles.volume.to((value) =>
					gainRef.current.setValue(value)
				),
				transform: springStyles.transform,
				backgroundColor: springStyles.volume.to({
					range: [0, 0.85, 1],
					output: ["white", "white", "hsl(207,100%,60%)"],
				}),
			}}
		>
			<div className={styles.avatarInset}>
				<video
					style={{ transform: mirror ? "scaleX(-1)" : null }}
					ref={videoRefFunc}
					muted
					autoPlay
					playsInline
				/>
				<div className={styles.avatarVolume}>
					{name} {Math.ceil(volume * 100)}
				</div>
			</div>
		</animated.div>
	);
}

function PeerAvatar({ peerHandler, listenerLocation }) {
	const [connected, setConnected] = React.useState(false);
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
			onConnect: () => {
				setConnected(true);
			},
			onDisconnect: () => {
				setConnected(false);
			},
			onName: setName,
			onStream: setMediaStream,
			onLocation: setLocation,
		});

		return () => {
			peerHandler.disconnect();
		};
	}, [peerHandler]);

	if (!connected) {
		return null;
	}

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
		sendSignal,
	}) {
		this.id = id;
		this.initiator = initiator;
		this.localName = localName;
		this.localLocation = localLocation;
		this.localMediaStream = localMediaStream;
		this.log = log;
		this.sendSignal = sendSignal;

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
			const { id, sendSignal } = this;

			this.log(`signal ${id}`);
			console.log(signal);

			sendSignal(signal);
		});

		peer.on("connect", () => {
			this.log("peer connect");
			this.connected = true;
			onConnect();
			peer.send(JSON.stringify({ type: "name", name: this.localName }));
			peer.send(
				JSON.stringify({ type: "location", location: this.localLocation })
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

	receiveSignal(signal) {
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
					onChooseLocation([e.nativeEvent.offsetX, e.nativeEvent.offsetY])
				}
			/>
			{children}
		</div>
	);
}

const JoinForm = ({ style, disabled, mediaStream, onInteract, onJoin }) => {
	const [name, setName] = React.useState("");

	return (
		<form
			className={styles.JoinForm}
			style={style}
			onSubmit={(e) => {
				e.preventDefault();
				onJoin(name);
			}}
		>
			<div className={styles.joinField}>
				<input
					placeholder="Name"
					type="text"
					disabled={disabled}
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>
			<div className={styles.joinField}>
				<input
					type="text"
					readOnly
					disabled
					value={mediaStream ? "Media ready" : "Waiting for media..."}
				/>
			</div>
			<div>
				<button disabled={disabled || !mediaStream} onClick={onInteract}>
					Join
				</button>
			</div>
		</form>
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
	const [panning, setPanning] = React.useState(false);

	const [audioContext] = React.useState(() => new AudioContext());
	const [audioDestination, setAudioDestination] = React.useState(null);
	const audioOutRef = React.useCallback(
		(ref) => {
			const dest = audioContext.createMediaStreamDestination();
			ref.srcObject = dest.stream;
			setAudioDestination(dest);
		},
		[audioContext]
	);

	const [location, setLocation] = React.useState(() => [
		worldWidth / 2,
		worldHeight / 2,
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
			audioContext.resume();
			document.getElementById("audioOut")?.play();

			const room = window.location.hash || secureUUID();
			window.location.hash = room;

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
					sendSignal: (signal) => {
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
					peerHandler.receiveSignal(msg.signal);
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
		[audioContext, handleCreateAvatar, handleDestroyAvatar, logit]
	);

	const handleChooseLocation = (location) => {
		if (!panning) {
			setLocation(location);
		}
	};

	React.useEffect(() => {
		Object.values(avatars).forEach((avatar) => {
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
			<audio id="audioOut" ref={audioOutRef} />
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

			<TransformWrapper
				pinch={{ step: 2 }}
				centerOnInit
				minScale={0.25}
				disabled={!peerTracker}
				onPanning={() => setPanning(true)}
				onPanningStop={() => setTimeout(() => setPanning(false), 10)}
			>
				<TransformComponent
					wrapperStyle={{
						background: "gray",
						maxWidth: "100vw",
						maxHeight: "100vh",
					}}
					contentClass={styles.transformContent}
					contentStyle={{
						width: `${worldWidth}px`,
						height: `${worldHeight}px`,
					}}
				>
					{peerTracker && <HUD onChooseLocation={handleChooseLocation}></HUD>}
					<Avatars
						audioContext={audioContext}
						audioDestination={audioDestination}
					>
						{peerTracker && (
							<Avatar
								listenerLocation={location}
								name={localName}
								mediaStream={mediaStream}
								location={location}
								muted
								mirror
							/>
						)}

						{Object.values(avatars).map((avatar) => (
							<PeerAvatar
								key={avatar.id}
								peerHandler={avatar.peerHandler}
								listenerLocation={location}
							/>
						))}
					</Avatars>
				</TransformComponent>
			</TransformWrapper>
			{transitions(
				(stylez, item) =>
					item && (
						<AnimatedJoinForm
							style={{ opacity: stylez.opacity }}
							disabled={!!peerTracker}
							mediaStream={mediaStream}
							onJoin={(name) => handleJoin(name, location, mediaStream)}
							onInteract={() => {
								audioOutRef.current?.play();
							}}
						/>
					)
			)}
		</>
	);
}
