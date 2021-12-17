var sdpConstraints = {
  optional: [],
  mandatory: {
    OfferToReceiveAudio: true,
    OfferToReceiveVideo: true
  }
};

function setupDC1(dc1) {
  try {
    var fileReceiver1 = new FileReceiver();
    dc1 = pc1.createDataChannel("test", { reliable: true });
    activedc = dc1;
    console.log("Created datachannel (pc1)");
    dc1.onopen = function (e) {
      console.log("data channel connect");
      $("#waitForConnection").modal("hide");
      $("#waitForConnection").remove();
    };
    dc1.onmessage = function (e) {
      console.log("Got message (pc1)", e.data);
      if (e.data.size) {
        fileReceiver1.receive(e.data, {});
      } else {
        if (e.data.charCodeAt(0) === 2) {
          // The first message we get from Firefox (but not Chrome)
          // is literal ASCII 2 and I don't understand why -- if we
          // leave it in, JSON.parse() will barf.
          return;
        }
        console.log(e);
        var data = JSON.parse(e.data);
        if (data.type === "file") {
          fileReceiver1.receive(e.data, {});
        } else {
          writeToChatLog(data.message, "text-info");
          // Scroll chat text area to the bottom on new input.
          $("#chatlog").scrollTop($("#chatlog")[0].scrollHeight);
        }
      }
    };
  } catch (e) {
    console.warn("No data channel (pc1)", e);
  }
}

export async function createLocalOffer() {
  console.log("video1");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    var video = document.getElementById("localVideo");
    video.srcObject = stream;
    video.play();
    pc1.addStream(stream);
    setupDC1();

    try {
      const offer = await pc1.createOffer({ iceRestart: false });
    } catch (error) {}
    pc1.createOffer(
      function (desc) {
        pc1.setLocalDescription(
          desc,
          function () {},
          function () {}
        );
        console.log("created local offer", desc);
      },
      function () {
        console.warn("Couldn't create offer");
      },
      sdpConstraints
    );
  } catch (error) {
    console.log("Error adding stream to pc1: " + error);
  }
}

export async function init() {
  const cfg = { iceServers: [{ urls: "stun:23.21.150.121" }] };
  const con = { optional: [{ DtlsSrtpKeyAgreement: true }] };

  /* THIS IS ALICE, THE CALLER/SENDER */

  const pc1 = new RTCPeerConnection(cfg, con);
  const dc1 = null;
  const tn1 = null;

  // Since the same JS file contains code for both sides of the connection,
  // activedc tracks which of the two possible datachannel variables we're using.
  var activedc;

  var pc1icedone = false;
}
