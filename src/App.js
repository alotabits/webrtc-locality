import React from "react";
import ReactDOM from "react-dom";
import cx from "clsx";
import styles from "./App.module.css";
import { faPhone, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useMediaStream } from "./hooks";
import { useImmer } from "use-immer";
import { animated, useSpring, config as springConfig } from "react-spring";

const Peer = window.SimplePeer;
const P2PT = window.P2PT;

function Avatars({ children }) {
  return <div className={[styles.Avatars]}>{children}</div>;
}

function Avatar({ mediaStream, location, listenerLocation, muted }) {
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
      Math.max(Math.pow(1 - d / window.innerWidth, 2.0), 0.0),
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
    config: springConfig.stiff
  });

  return (
    <animated.div
      className={cx(styles.Avatar, playing && styles.avatarVideo)}
      style={springStyles}
    >
      <div className={styles.avatarInset}>
        <video ref={videoRefFunc} muted={muted} autoPlay />
        <div className={styles.avatarVolume}>{Math.ceil(volume * 100)}</div>
      </div>
    </animated.div>
  );
}

function PeerAvatar({
  localMediaStream,
  localLocation,
  initiator,
  onSignal,
  onVideoPeer
}) {
  const [videoPeer, setVideoPeer] = React.useState(null);
  const [peerMediaStream, setPeerMediaStream] = React.useState(null);
  const [peerLocation, setPeerLocation] = React.useState(() => {
    // Randomly outside grid?
    return [
      Math.random() * window.innerWidth,
      Math.random() * window.innerHeight
    ];
  });

  React.useEffect(() => {
    const videoPeer = new Peer({
      initiator,
      trickle: true,
      stream: localMediaStream
    });

    videoPeer.on("signal", (signal) => {
      console.log("videoPeer signal", signal);
      onSignal(signal);
    });

    videoPeer.on("stream", (stream) => {
      console.log("videoPeer stream");
      setPeerMediaStream(stream);
    });

    videoPeer.on("track", (track) => {
      console.log("videoPeer track", track);
    });

    videoPeer.on("data", (payload) => {
      const data = JSON.parse(payload);
      if (data.type === "location") {
        console.log("LOCATION", data);
        setPeerLocation(data.location);
      }
    });

    videoPeer.on("connect", () => {
      setVideoPeer(videoPeer);
    });

    onVideoPeer(videoPeer);
  }, [localMediaStream, initiator, onSignal, onVideoPeer]);

  React.useEffect(() => {
    if (!videoPeer) {
      return;
    }

    const payload = { type: "location", location: localLocation };
    videoPeer.send(JSON.stringify(payload));
  }, [videoPeer, localLocation]);

  return (
    <Avatar
      mediaStream={peerMediaStream}
      location={peerLocation}
      listenerLocation={localLocation}
      muted={false}
    />
  );
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

export default function App() {
  const [peerTracker, setPeerTracker] = React.useState(null);

  React.useEffect(() => {
    const interval = setInterval(() => {
      if (peerTracker) {
        peerTracker.requestMorePeers();
      }
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [peerTracker]);

  const [location, setLocation] = React.useState(() => [
    window.innerWidth / 2,
    window.innerHeight / 2
  ]);

  const { mediaStream, error: mediaError } = useMediaStream({
    video: true,
    audio: true
  });

  const [avatars, updateAvatars] = useImmer({});

  const handleJoin = React.useCallback(() => {
    const room = window.location.hash || "general";

    let announceURLs = [
      "wss://tracker.openwebtorrent.com"
      // Connections fail:
      // "wss://tracker.sloppyta.co:443/announce",
      // "wss://tracker.novage.com.ua:443/announce"
      // "wss://tracker.btorrent.xyz:443/announce"
    ];

    const p2pt = new P2PT(announceURLs, "webrtc-locality-" + room);

    p2pt.on("peerconnect", (peer) => {
      console.log("peerconnect");

      const onSignal = (signal) => {
        console.log("signal", signal);
        p2pt.send(peer, {
          type: "signal",
          signal
        });
      };

      const onVideoPeer = (videoPeer) => {
        const onMsgSignal = (msgPeer, msg) => {
          console.log("msg", peer, msg);
          // Reject messages for other peers, since this is a common bus
          if (msgPeer.id !== peer.id || msg.type !== "signal") {
            return;
          }

          videoPeer.signal(msg.signal);
        };

        p2pt.on("msg", onMsgSignal);

        updateAvatars((draftAvatars) => {
          draftAvatars[peer.id].onMsgSignal = onMsgSignal;
        });
      };

      updateAvatars((draftAvatars) => {
        draftAvatars[peer.id] = {
          signalingPeer: peer,
          onSignal,
          onVideoPeer
        };
      });
    });

    p2pt.on("peerclose", (peer) => {
      console.log("peerclose");

      // This fails because we're closed over avatars on an old render.
      p2pt.off("msg", avatars[peer.id].onMsgSignal);

      updateAvatars((draftAvatars) => {
        delete draftAvatars[peer.id];
      });
    });

    p2pt.start();
    setPeerTracker(p2pt);
  }, [avatars, updateAvatars]);

  const handleChooseLocation = (location) => {
    setLocation(location);
  };

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
      <Avatars>
        {Object.values(avatars).map((avatar) => (
          <PeerAvatar
            key={avatar.signalingPeer.id}
            localMediaStream={mediaStream}
            localLocation={location}
            initiator={avatar.signalingPeer.initiator}
            onSignal={avatar.onSignal}
            onVideoPeer={avatar.onVideoPeer}
          />
        ))}

        <Avatar
          mediaStream={mediaStream}
          location={location}
          listenerLocation={location}
          muted
        />
      </Avatars>

      <HUD onChooseLocation={handleChooseLocation}>
        <button
          type="button"
          style={{ position: "absolute", left: "0", top: "0" }}
          disabled={!!peerTracker}
          onClick={handleJoin}
        >
          Join
        </button>
      </HUD>
    </>
  );
}
