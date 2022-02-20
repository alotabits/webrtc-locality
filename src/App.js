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
import { actions, PeerJSManager } from "./peerjs-manager";

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

function PeerAvatar({ peerHandler, ...props }) {
	const [peerState, setPeerState] = React.useState(null);

	React.useEffect(() => {
		peerHandler?.attach({
			onPeerState: setPeerState,
		});

		return () => {
			peerHandler?.detach();
		};
	}, [peerHandler]);

	if (!peerState) {
		return null;
	}

	return <Avatar {...peerState} {...props} />;
}

function HUD({ children }) {
	return <div className={styles.HUD}>{children}</div>;
}

const JoinForm = ({ style, disabled, onInteract, onJoin }) => {
	const [name, setName] = React.useState("");
	const { mediaStream, error: mediaError } = useMediaStream({
		video: true,
		audio: true,
	});

	return (
		<form
			className={styles.JoinForm}
			style={style}
			onSubmit={(e) => {
				e.preventDefault();
				onJoin(name, mediaStream);
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
					value={
						mediaError
							? mediaError.toString()
							: mediaStream
							? "Media ready"
							: "Waiting for media..."
					}
				/>
			</div>
			<div>
				<button
					disabled={disabled || !!mediaError || !mediaStream}
					onClick={onInteract}
				>
					Join
				</button>
			</div>
		</form>
	);
};

const AnimatedJoinForm = animated(JoinForm);

export default function App({ getLogQueue }) {
	const consoleLogRef = React.useRef([]);

	useEffect(() => {
		const consoleLog = (...args) =>
			consoleLogRef.current.push(
				args
					.map((arg) =>
						typeof arg !== "string" ? JSON.stringify(arg, undefined, 2) : arg
					)
					.join(" ")
			);
		getLogQueue(consoleLog).forEach(consoleLog);
	}, [getLogQueue]);

	const [panning, setPanning] = React.useState(false);

	const [avatarAudio] = React.useState(() => {
		const context = new AudioContext();
		const destination = context.createMediaStreamDestination();
		const element = document.createElement("audio");

		document.body.appendChild(element);

		return {
			audioContext: context,
			audioDestination: destination,
			audioPlay: () => {
				try {
					context.resume();
					element.srcObject = destination.stream;
					element.play();
				} catch (error) {
					console.error(error);
				}
			},
		};
	});
	const [avatars, updateAvatars] = useImmer({});
	const [peerManager] = React.useState(() => {
		const m = new PeerJSManager();
		window.m = m;
		return m;
	});
	const [avatarState, setAvatarState] = React.useState(() =>
		peerManager.getLocalState()
	);

	const handleJoin = React.useCallback(
		(joinName, joinMediaStream) => {
			setAvatarState(peerManager.dispatch(actions.setName(joinName)));
			setAvatarState(
				peerManager.dispatch(actions.setMediaStream(joinMediaStream))
			);

			const handlePeerConnect = (id, peerHandler) => {
				console.log(`handlePeerConnect: ${id}`);
				updateAvatars((draftAvatars) => {
					draftAvatars[id] = { id, peerHandler };
				});
			};

			const handlePeerDisconnect = (id) => {
				console.log(`handlePeerDisconnect: ${id}`);
				updateAvatars((draftAvatars) => {
					delete draftAvatars[id];
				});
			};

			peerManager.start({
				onOpen: (id) => {
					if (window.location.hash) {
						peerManager.connect(window.location.hash.slice(1));
					}
					window.location.hash = id;
				},
				onPeerConnect: handlePeerConnect,
				onPeerDisconnect: handlePeerDisconnect,
			});
		},
		[peerManager, updateAvatars]
	);

	const handleChooseLocation = (location) => {
		if (!panning) {
			setAvatarState(peerManager.dispatch(actions.setLocation(location)));
		}
	};

	const transitions = useTransition(!avatarState.mediaStream, {
		enter: {
			opacity: 1,
		},
		leave: {
			opacity: 0,
		},
	});

	const [logOpen, setLogOpen] = React.useState(false);

	const logRef = React.useRef(null);
	React.useEffect(() => {
		const el = logRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [logOpen]);

	return (
		<>
			<TransformWrapper
				pinch={{ step: 2 }}
				centerOnInit
				minScale={0.25}
				disabled={!peerManager}
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
					<div
						style={{ position: "absolute", inset: 0 }}
						onClick={(e) =>
							handleChooseLocation([
								e.nativeEvent.offsetX,
								e.nativeEvent.offsetY,
							])
						}
					/>
					<Avatars
						audioContext={avatarAudio.audioContext}
						audioDestination={avatarAudio.audioDestination}
					>
						{avatarState.mediaStream && (
							<Avatar
								{...avatarState}
								listenerLocation={avatarState.location}
								muted
								mirror
							/>
						)}

						{Object.values(avatars).map((avatar) => (
							<PeerAvatar
								key={avatar.id}
								peerHandler={avatar.peerHandler}
								listenerLocation={avatarState.location}
							/>
						))}
					</Avatars>
				</TransformComponent>
			</TransformWrapper>
			<HUD>
				<div ref={logRef} className={cx(styles.log, logOpen && styles.logOpen)}>
					Log:
					{consoleLogRef.current.map((entry, i) => (
						<div key={i} style={{ display: "flex", flexFlow: "row nowrap" }}>
							<div style={{ fontSize: "0.8em" }}>►&nbsp;</div>
							<pre style={{ margin: 0 }}>{entry}</pre>
						</div>
					))}
				</div>
				<button onClick={() => setLogOpen((v) => !v)}></button>
			</HUD>
			{transitions(
				(stylez, item) =>
					item && (
						<AnimatedJoinForm
							style={{ opacity: stylez.opacity }}
							onJoin={(name, mediaStream) => handleJoin(name, mediaStream)}
							onInteract={avatarAudio.audioPlay}
						/>
					)
			)}
		</>
	);
}
