import React from "react";
import ReactDOM from "react-dom";
import cx from "clsx";
import styles from "./App.module.css";

function usePromise(promise, initState = null) {
  const [state, setState] = React.useState(initState);

  React.useEffect(() => {
    let canceled = false;

    // eslint-disable-next-line no-unused-expressions
    promise?.then((value) => {
      if (!canceled) {
        setState(value);
      }
    });

    return () => {
      canceled = true;
    };
  }, [promise]);

  return state;
}

function useAsyncEffect(effect, deps) {
  const mountedRef = React.useRef(true);
  const mountedFuncRef = React.useRef(() => mountedRef.current);

  React.useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  React.useEffect(() => {
    effect(mountedFuncRef.current);
  }, deps);
}

/**
 * @param {Boolean} video
 * @param {Boolean} audio
 */
function useMediaStream({ video, audio }) {
  // Set a stable initState object in the ref.current
  // So a setState with that object when we're already in the initState will bail on re-render.
  const initState = React.useRef({
    mediaStream: null,
    error: null
  });

  const [state, setState] = React.useState(initState.current);

  useAsyncEffect(
    async (isMounted) => {
      try {
        setState(initState.current);

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio,
          video
        });

        if (isMounted()) {
          setState({
            ...initState.current,
            mediaStream,
            error: null
          });
        }
      } catch (error) {
        console.log(error);
        if (isMounted()) {
          setState({
            ...initState.current,
            mediaStream: null,
            error
          });
        }
      }
    },
    [video, audio]
  );

  return state;
}

function Avatars({ children }) {
  return <div className={[styles.Avatars]}>{children}</div>;
}

function Avatar({
  dataChannel: propsDataChannel,
  mediaStream,
  muted,
  location: propsLocation,
  micLocation
}) {
  const [playing, setPlaying] = React.useState(false);
  const videoRef = React.useRef(null);

  const [stateLocation, setStateLocation] = React.useState(() => [
    Math.random() * window.innerWidth,
    Math.random() * window.innerHeight
  ]);

  const location = propsLocation || stateLocation;
  const dataChannel = usePromise(propsDataChannel);

  React.useEffect(() => {
    if (dataChannel) {
      dataChannel.addEventListener("message", (e) => {
        const data = JSON.parse(e.data);
        console.log("LOCATION", data);
        setStateLocation(data);
      });
    }
  }, [dataChannel]);

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
    const l = location;
    const m = micLocation || location;
    const d = Math.sqrt(Math.pow(m[0] - l[0], 2) + Math.pow(m[1] - l[1], 2));
    const v = muted
      ? 0
      : Math.min(Math.max(Math.pow(1 - d / window.innerWidth, 2.0), 0.0), 1.0);
    return v;
  }, [location, micLocation, muted]);

  React.useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume]);

  const transform = `translate(${location[0]}px, ${location[1]}px) translate(-50%, -50%)`;

  return (
    <div
      className={cx(styles.Avatar, playing && styles.avatarVideo)}
      style={{ transform }}
    >
      <div className={styles.avatarInset}>
        <video ref={videoRefFunc} muted={muted} autoPlay />
        <div className={styles.avatarVolume}>{Math.ceil(volume * 100)}</div>
      </div>
    </div>
  );
}

function CallDialog({ mediaStream, answer, onConnect }) {
  const [payload, setPayload] = React.useState(null);
  /** @type React.Ref<RTCPeerConnection> */
  const peerConn = React.useRef(null);

  const handleMakeCall = React.useCallback(async (mediaStream) => {
    try {
      const pc = new RTCPeerConnection({
        //iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      mediaStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, mediaStream));

      // Use a promise so that caller/answerer look the same to Avatar code.
      pc.dataChannel = Promise.resolve(pc.createDataChannel("avatar"));

      peerConn.current = pc;

      const iceGathering = new Promise((resolve, reject) => {
        pc.addEventListener("icecandidate", (e) => {
          console.log("icecandidate", e);
          if (e.candidate === null) {
            console.log("FINAL");
            resolve(pc.localDescription);
          }
        });
        pc.addEventListener("icecandidateerror", (e) => {
          console.log("icecandidateerror", e);
          reject(e);
        });
      });

      console.log("OFFER");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log("GATHERING");
      const finalOffer = await iceGathering;
      console.log("GATHERING COMPLETE");

      console.log("SETTING");
      setPayload(finalOffer);
    } catch (e) {
      console.log("handleMakeCall", e);
    }
  }, []);

  const handleMakeAnswer = React.useCallback(async (mediaStream, offerDesc) => {
    try {
      const pc = new RTCPeerConnection({
        //iceServers: [{ urls: "stun:23.21.150.121" }]
      });
      mediaStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, mediaStream));

      // The calling side is responsible for creating the data channel
      pc.dataChannel = new Promise((resolve) => {
        pc.addEventListener("datachannel", (e) => {
          window.channel = e.channel;
          resolve(e.channel);
        });
      });

      peerConn.current = pc;

      await pc.setRemoteDescription(offerDesc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      setPayload(answer);
    } catch (e) {
      console.log("handleMakeAnswer", e);
    }
  }, []);

  React.useEffect(() => {
    if (!answer && mediaStream) {
      handleMakeCall(mediaStream);
    }
  }, [mediaStream, answer, handleMakeCall]);

  React.useEffect(
    () => () => {
      if (peerConn.current) {
        peerConn.current.close();
      }
    },
    []
  );

  return ReactDOM.createPortal(
    <div className={styles.CallDialog}>
      <button
        disabled={!payload}
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(JSON.stringify(payload));
        }}
      >
        {answer ? "Copy Answer to Clipboad" : "Copy Call to Clipboard"}
      </button>
      <button
        type="button"
        onClick={async () => {
          if (answer && mediaStream) {
            // Receive call
            const offer = JSON.parse(await navigator.clipboard.readText());
            const offerDesc = new RTCSessionDescription(offer);
            await handleMakeAnswer(mediaStream, offerDesc);
            const pc = peerConn.current;
            peerConn.current = null;
            onConnect(pc);
          } else {
            // Recieve answer
            const answer = JSON.parse(await navigator.clipboard.readText());
            const answerDesc = new RTCSessionDescription(answer);
            const pc = peerConn.current;
            peerConn.current = null;
            // TODO: can't go round 2 with calls because this is gone
            await pc.setRemoteDescription(answerDesc);
            onConnect(pc);
          }
        }}
      >
        {answer ? "Read Call from Clipboard" : "Read Answer from Clipboard"}
      </button>
    </div>,
    document.body
  );
}

function HUD({ onChooseLocation }) {
  return (
    <div
      className={cx(styles.HUD)}
      onClick={(e) =>
        console.log("click", e.clientX) ||
        onChooseLocation([e.clientX, e.clientY])
      }
    ></div>
  );
}

export default function App() {
  const [location, setLocation] = React.useState(() => [
    window.innerWidth / 2,
    window.innerHeight / 2
  ]);
  const { mediaStream } = useMediaStream({
    video: true,
    audio: true
  });

  const [peers, setPeers] = React.useState([]);

  const handleConnect = (/** @type RTCPeerConnection */ peerConn) => {
    console.log("CONNECTED", peerConn);

    const mediaStream = new MediaStream(
      peerConn.getReceivers().map((receiver) => receiver.track)
    );

    /*
    const audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(mediaStream);
    const gain = audioCtx.createGain();
    const dst = audioCtx.createMediaStreamDestination();
    src.connect(gain);
    // gain.connect(dst);
    src.connect(dst);

    gain.gain.value = 1;
    window.gain = gain;
    window.dst = dst;
    */

    setPeers((prevPeers) => [
      ...prevPeers,
      {
        peerConn,
        mediaStream //: dst.stream
        //gain
      }
    ]);

    peerConn.addEventListener("connectionstatechange", (event) => {
      switch (event.target.connectionState) {
        case "connected":
          // The connection has become fully connected
          break;
        case "disconnected":
        case "failed":
          // One or more transports has terminated unexpectedly or in an error
          setPeers((peers) =>
            peers.filter((peer) => peer.mediaStream.id !== mediaStream.id)
          );
          break;
        case "closed":
          // The connection has been closed
          setPeers((peers) =>
            peers.filter((peer) => peer.mediaStream.id !== mediaStream.id)
          );
          break;
        default:
          break;
      }
    });
  };

  const handleChooseLocation = (location) => {
    peers.forEach(async (peer) => {
      (await peer.peerConn.dataChannel).send(JSON.stringify(location));
    });
    setLocation(location);
  };

  return (
    <>
      <Avatars>
        {peers.map((peer) => (
          <Avatar
            key={peer.mediaStream.id}
            dataChannel={peer.peerConn.dataChannel}
            mediaStream={peer.mediaStream}
            micLocation={location}
          />
        ))}

        <Avatar mediaStream={mediaStream} location={location} muted />
      </Avatars>

      <CallDialog
        mediaStream={mediaStream}
        answer={window.location.hash === "#answer"}
        onConnect={handleConnect}
      />

      <HUD onChooseLocation={handleChooseLocation} />
    </>
  );
}
