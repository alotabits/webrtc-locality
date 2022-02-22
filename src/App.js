import {
  faFileAlt,
  faQrcode,
  faShare,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { DialogContent, DialogOverlay } from "@reach/dialog";
import "@reach/dialog/styles.css";
import cx from "clsx";
import qrious from "qrious";
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

// General Components

const Input = ({ className, ...props }) => {
  return (
    <div className={cx(styles.Input, className)}>
      <input {...props} />
    </div>
  );
};

const Button = ({ children, onClick }) => {
  return (
    <div className={styles.Button}>
      <div className={styles.buttonContent}>{children}</div>
      <button onClick={onClick} />
    </div>
  );
};

const TextButton = ({ disabled, onClick, children }) => {
  /*
  const [borderRadius] = React.useState(() => {
    const values = Array.from(8);
    for (let i = 0; i < 8; i++) {
      values[i] = Math.random() * 30 + 50;
    }
    return `${values.slice(0, 4).join("% ")}% / ${values.slice(4).join("% ")}%`;
  });
  */

  return (
    <button
      disabled={disabled}
      className={styles.TextButton}
      // style={{ borderRadius }}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

const Icon = ({ icon, color = "white" }) => {
  return <FontAwesomeIcon icon={icon} color={color} />;
};

// App Components

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
      <div className={styles.Avatars}>{children}</div>
    </AvatarContext.Provider>
  );
}

function Avatar({
  listenerLocation,
  name,
  mediaStream,
  location,
  group,
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
          output: ["var(--sand-1)", "var(--sand-1)", "var(--sand-2)"],
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
          {name}
          {group ? ` (${group})` : ""}
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

const Region = ({ anchor, children }) => {
  const anchorClass = {
    topLeft: styles.topLeft,
    topRight: styles.topRight,
    bottomLeft: styles.bottomLeft,
    bottomRight: styles.bottomRight,
  }[anchor];
  return <div className={cx(styles.Region, anchorClass)}>{children}</div>;
};

const StartForm = ({ join, version, onStart }) => {
  const [name, setName] = React.useState("");
  const { mediaStream, error: mediaError } = useMediaStream({
    video: true,
    audio: true,
  });
  const videoRef = React.useRef();
  useEffect(() => {
    videoRef.current.srcObject = mediaStream;
  }, [mediaStream]);

  return (
    <form
      className={styles.StartForm}
      onSubmit={(e) => {
        e.preventDefault();
        onStart(name, mediaStream);
      }}
    >
      <div className={styles.title}>
        Archipelago
        <sup>{version}</sup>
      </div>
      <div className={styles.video}>
        <video ref={videoRef} muted autoPlay playsInline />
      </div>
      <div className={styles.startField}>
        <Input
          placeholder="Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className={styles.startField}>
        <Input
          type="hidden"
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
        <TextButton disabled={!!mediaError || !mediaStream}>
          {join ? "Join" : "Create"}
        </TextButton>
      </div>
    </form>
  );
};

function makeJoinLink(id) {
  const url = new URL(window.location);
  url.searchParams.set("join", id);
  return url.toString();
}

const Qr = ({ id, onClose }) => {
  const imgRef = React.useCallback(
    (imgEl) => {
      new qrious({
        element: imgEl,
        value: makeJoinLink(id),
        size: 200,
      });
    },
    [id]
  );
  return (
    <div className={styles.Qr}>
      <img alt="" ref={imgRef} />
      <TextButton onClick={onClose}>Close</TextButton>
    </div>
  );
};

const AnimatedDialogOverlay = animated(DialogOverlay);

const FadeDialog = ({ className, isOpen, onDismiss, ...props }) => {
  const transitions = useTransition(isOpen, {
    from: {
      opacity: 0,
    },
    enter: {
      opacity: 1,
    },
    leave: {
      opacity: 0,
    },
  });

  return transitions(
    (stylez, item) =>
      item && (
        <AnimatedDialogOverlay
          className={styles.FadeDialog}
          style={stylez}
          onDismiss={onDismiss}
        >
          <DialogContent
            className={cx(styles.fadeDialogContent, className)}
            aria-label="dialog"
            {...props}
          />
        </AnimatedDialogOverlay>
      )
  );
};

const GroupForm = ({ onGroup }) => {
  const [groupName, setGroupName] = React.useState();

  return (
    <form
      className={styles.GroupForm}
      onSubmit={(e) => {
        e.preventDefault();
        onGroup(groupName);
      }}
    >
      <div>Choose a group name.</div>
      <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
      <TextButton>Ok</TextButton>
    </form>
  );
};

export default function App({ getLogQueue, query, version }) {
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
          element.srcObject = destination.stream;
          context.resume();
          element.play();
        } catch (error) {
          console.error(error);
        }
      },
    };
  });
  const [avatars, updateAvatars] = useImmer({});
  const [peerManager] = React.useState(() => {
    const m = new PeerJSManager({
      location: [worldWidth / 2, worldHeight / 2],
    });
    window.m = m;
    return m;
  });
  const [avatarState, setAvatarState] = React.useState(() =>
    peerManager.getLocalState()
  );

  const handleStart = React.useCallback(
    (startName, startMediaStream, joinId) => {
      avatarAudio.audioPlay();
      setAvatarState(peerManager.dispatch(actions.setName(startName)));
      setAvatarState(
        peerManager.dispatch(actions.setMediaStream(startMediaStream))
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
          if (joinId) {
            peerManager.connect(joinId);
          }
        },
        onPeerConnect: handlePeerConnect,
        onPeerDisconnect: handlePeerDisconnect,
      });
    },
    [peerManager, avatarAudio, updateAvatars]
  );

  const handleChooseLocation = (location) => {
    if (!panning) {
      setAvatarState(peerManager.dispatch(actions.setLocation(location)));
    }
  };

  const [qrDialogOpen, setQrDialogOpen] = React.useState(false);

  const [logOpen, setLogOpen] = React.useState(false);

  const [groupOpen, setGroupOpen] = React.useState(false);

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
          wrapperClass={styles.transformWrapper}
          contentClass={styles.transformContent}
          contentStyle={{
            width: `${worldWidth}px`,
            height: `${worldHeight}px`,
          }}
        >
          <div
            className={styles.locator}
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
        <Region anchor="topLeft">
          <Button onClick={() => setLogOpen((v) => !v)}>
            <Icon icon={faFileAlt} />
          </Button>
        </Region>
        <Region anchor="bottomLeft">
          <Button
            onClick={() => {
              navigator
                .share({
                  url: makeJoinLink(peerManager.id),
                })
                .catch((err) => console.error(err));
            }}
          >
            <Icon icon={faShare} />
          </Button>
          <Button onClick={() => setQrDialogOpen(true)}>
            <Icon icon={faQrcode} />
          </Button>
        </Region>
        <Region anchor="topRight">
          <Button onClick={() => setGroupOpen(true)}>
            <Icon icon={faUsers} />
          </Button>
        </Region>
      </HUD>

      <FadeDialog
        className={styles.logDialog}
        isOpen={logOpen}
        onDismiss={() => setLogOpen(false)}
      >
        <div ref={logRef} className={styles.logContent}>
          {consoleLogRef.current.map((entry, i) => (
            <div key={i} className={styles.logEntry}>
              <div className={styles.logArrow}>►&nbsp;</div>
              <pre className={styles.logText}>{entry}</pre>
            </div>
          ))}
        </div>
        <TextButton onClick={() => setLogOpen(false)}>Close</TextButton>
      </FadeDialog>

      <FadeDialog isOpen={!avatarState.mediaStream}>
        <StartForm
          join={!!query.get("join")}
          version={version}
          onStart={(name, mediaStream) =>
            handleStart(name, mediaStream, query.get("join"))
          }
        />
      </FadeDialog>

      <FadeDialog
        isOpen={qrDialogOpen}
        onDismiss={() => setQrDialogOpen(false)}
      >
        <Qr id={peerManager.id} onClose={() => setQrDialogOpen(false)} />
      </FadeDialog>

      <FadeDialog isOpen={groupOpen} onDismiss={() => setGroupOpen(false)}>
        <GroupForm
          onGroup={(groupName) => {
            setGroupOpen(false);
            setAvatarState(peerManager.dispatch(actions.setGroup(groupName)));
          }}
        />
      </FadeDialog>
    </>
  );
}
