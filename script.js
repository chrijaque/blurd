const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startChatButton = document.getElementById('startChatButton');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');
const muteButton = document.getElementById('muteButton');
const videoToggleButton = document.getElementById('videoToggleButton');
const toggleBlurButton = document.getElementById('toggleBlurButton');
const statusMessage = document.getElementById('statusMessage');

let localStream;
let peerConnection;
let isMuted = false;
let isVideoOn = true;
let isBlurred = true; // Blur effect enabled by default
let canvasContext;
let canvasStream;

const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Create a canvas for video processing (mirroring and blur)
const videoCanvas = document.createElement('canvas');
canvasContext = videoCanvas.getContext('2d');

// WebSocket signaling server connection
const socket = new WebSocket('ws://localhost:8080');

// Start Chat button: initialize the video chat
startChatButton.addEventListener('click', () => {
    startChatButton.disabled = true;
    nextButton.disabled = false;
    disconnectButton.disabled = false;
    muteButton.disabled = false;
    videoToggleButton.disabled = false;
    toggleBlurButton.disabled = false; // Enable the blur toggle button

    // Get local media stream (audio & video)
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
            localStream = stream;
            localVideo.srcObject = stream; // Keep the local video visible
            localVideo.style.transform = 'scaleX(-1)'; // Mirror the local video

            statusMessage.textContent = 'Waiting for a peer...';

            // Set up canvas for processing (mirroring & blur)
            videoCanvas.width = localVideo.videoWidth || 640;
            videoCanvas.height = localVideo.videoHeight || 480;

            // Start processing the local stream on the canvas
            startCanvasProcessing();

            // Notify the server that we're ready to chat
            socket.send(JSON.stringify({ type: 'ready' }));
        })
        .catch((error) => {
            console.error('Error accessing media devices.', error);
        });
});

// Handle incoming signaling messages
socket.onmessage = async (message) => {
    const data = JSON.parse(message.data);

    switch (data.type) {
        case 'connected':
            statusMessage.textContent = 'Connected to a peer!';
            startWebRTC();
            break;
        case 'offer':
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.send(JSON.stringify({ type: 'answer', answer: peerConnection.localDescription }));
            break;
        case 'answer':
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            break;
        case 'ice-candidate':
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            break;
        case 'disconnected':
            handleDisconnect();
            break;
        default:
            break;
    }
};

// Start WebRTC when connected to a peer
function startWebRTC() {
    peerConnection = new RTCPeerConnection(configuration);

    // Add the processed canvas stream (blurred & mirrored) to peer connection
    canvasStream = videoCanvas.captureStream();
    canvasStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, canvasStream);
    });

    // Handle incoming stream from the remote peer
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        // Apply blur effect to the remote video by default
        remoteVideo.style.filter = isBlurred ? 'blur(10px)' : 'none';
        remoteVideo.style.transform = 'scaleX(-1)'; // Mirror the remote video
    };

    // Send ICE candidates to the signaling server
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
        }
    };

    // Create and send an offer
    peerConnection.createOffer()
        .then((offer) => {
            return peerConnection.setLocalDescription(offer);
        })
        .then(() => {
            socket.send(JSON.stringify({ type: 'offer', offer: peerConnection.localDescription }));
        });
}

// Process the local video through the canvas (mirroring and blur)
function startCanvasProcessing() {
    function processFrame() {
        // Clear the previous frame
        canvasContext.clearRect(0, 0, videoCanvas.width, videoCanvas.height);

        // Apply blur effect if enabled
        if (isBlurred) {
            canvasContext.filter = 'blur(10px)';
            localVideo.style.filter = 'blur(10px)'; // Apply blur effect to local video
        } else {
            canvasContext.filter = 'none';
            localVideo.style.filter = 'none'; // Remove blur from local video
        }

        // Mirror the video frame by flipping the canvas horizontally
        canvasContext.save(); // Save the current state of the canvas
        canvasContext.scale(-1, 1); // Flip horizontally
        canvasContext.translate(-videoCanvas.width, 0); // Translate to the correct position

        // Draw the current video frame on the canvas (mirrored)
        canvasContext.drawImage(localVideo, 0, 0, videoCanvas.width, videoCanvas.height);

        canvasContext.restore(); // Restore the original state of the canvas

        // Continue processing frames
        requestAnimationFrame(processFrame);
    }

    processFrame();
}

// Next button: Skip to the next random peer
nextButton.addEventListener('click', () => {
    handleDisconnect();
    statusMessage.textContent = 'Searching for a new peer...';
    socket.send(JSON.stringify({ type: 'ready' }));
});

// Disconnect button: End the chat session
disconnectButton.addEventListener('click', () => {
    handleDisconnect();
    statusMessage.textContent = 'You have disconnected.';
});

// Handle disconnect logic
function handleDisconnect() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    socket.send(JSON.stringify({ type: 'disconnected' }));
}

// Mute audio
muteButton.addEventListener('click', () => {
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    muteButton.textContent = isMuted ? 'Unmute Audio' : 'Mute Audio';
});

// Toggle video
videoToggleButton.addEventListener('click', () => {
    isVideoOn = !isVideoOn;
    localStream.getVideoTracks()[0].enabled = isVideoOn;
    videoToggleButton.textContent = isVideoOn ? 'Turn Off Video' : 'Turn On Video';
});

// Toggle the blur effect for local and peer video
toggleBlurButton.addEventListener('click', () => {
    isBlurred = !isBlurred;
    toggleBlurButton.textContent = isBlurred ? 'Remove Blur' : 'Apply Blur';

    // Apply or remove blur for both local and remote videos
    if (localVideo.srcObject) {
        localVideo.style.filter = isBlurred ? 'blur(10px)' : 'none';
    }
    if (remoteVideo.srcObject) {
        remoteVideo.style.filter = isBlurred ? 'blur(10px)' : 'none';
    }
});