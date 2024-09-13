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
let iceCandidatesQueue = []; // Queue ICE candidates until remote description is set

// Define videoCanvas and its context
const videoCanvas = document.createElement('canvas');
const canvasContext = videoCanvas.getContext('2d');

let socket;
let reconnectInterval;

// TURN server configuration (replace with your Xirsys credentials)
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            username: "NtUxUgJUFwDb1LrBQAXzLGpsqx9PBXQQnEa0a1s2LL3T93oSqD2a3jC1gqM1SG27AAAAAGbjXnBjaHJpamFxdWU=",
            credential: "d11f86be-714e-11ef-8726-0242ac120004",
            urls: [
                "turn:fr-turn1.xirsys.com:80?transport=udp",
                "turn:fr-turn1.xirsys.com:3478?transport=udp",
                "turn:fr-turn1.xirsys.com:80?transport=tcp",
                "turn:fr-turn1.xirsys.com:3478?transport=tcp",
                "turns:fr-turn1.xirsys.com:443?transport=tcp",
                "turns:fr-turn1.xirsys.com:5349?transport=tcp"
            ]
        }
    ]
};

// WebSocket signaling server connection with auto-reconnect
function initWebSocket() {
    socket = new WebSocket('wss://blurd.adaptable.app');

    socket.onopen = () => {
        console.log('WebSocket connection established');
        if (reconnectInterval) clearInterval(reconnectInterval); // Stop reconnection attempts
        sendMessage(JSON.stringify({ type: 'ready' }));
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    socket.onmessage = handleSignalingMessage;

    socket.onclose = () => {
        console.warn('WebSocket closed. Attempting to reconnect...');
        reconnectInterval = setInterval(() => {
            console.log('Attempting to reconnect WebSocket...');
            initWebSocket();
        }, 3000); // Try to reconnect every 3 seconds
    };
}

initWebSocket(); // Initialize the WebSocket when the page loads

// Ensure WebSocket is connected before sending messages
function sendMessage(message) {
    if (socket.readyState === WebSocket.OPEN) {
        console.log('Sending message:', message);
        socket.send(message);
    } else {
        console.error('WebSocket is not open yet, message not sent.');
    }
}

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
            sendMessage(JSON.stringify({ type: 'ready' }));
        })
        .catch((error) => {
            console.error('Error accessing media devices.', error);
        });
});

// Handle incoming signaling messages
function handleSignalingMessage(message) {
    const data = JSON.parse(message.data);

    switch (data.type) {
        case 'connected':
            statusMessage.textContent = 'Connected to a peer!';
            startWebRTC();
            break;
        case 'offer':
            // Ensure we only handle offers when the signaling state is stable
            if (peerConnection.signalingState === 'stable') {
                console.log('Received offer');
                peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))
                    .then(() => peerConnection.createAnswer())
                    .then((answer) => peerConnection.setLocalDescription(answer))
                    .then(() => sendMessage(JSON.stringify({ type: 'answer', answer: peerConnection.localDescription })));
                processQueuedIceCandidates();
            } else {
                console.error('Cannot handle offer in current signaling state:', peerConnection.signalingState);
            }
            break;
        case 'answer':
            if (peerConnection.signalingState === 'have-local-offer') {
                console.log('Received answer');
                peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                processQueuedIceCandidates();
            } else {
                console.error('Cannot handle answer in current signaling state:', peerConnection.signalingState);
            }
            break;
        case 'ice-candidate':
            console.log('Received ICE candidate:', data.candidate);
            if (peerConnection.remoteDescription) {
                peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                    .then(() => {
                        console.log('Successfully added received ICE candidate');
                    })
                    .catch((error) => {
                        console.error('Error adding received ICE candidate:', error);
                    });
            } else {
                console.log('Remote description not set yet, queuing the ICE candidate');
                iceCandidatesQueue.push(data.candidate);
            }
            break;
        case 'disconnected':
            handleDisconnect();
            break;
        default:
            break;
    }
}

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
        console.log('Remote track received:', event.streams[0]);
        remoteVideo.srcObject = event.streams[0];
        // Apply blur effect to the remote video by default
        remoteVideo.style.filter = isBlurred ? 'blur(10px)' : 'none';
        remoteVideo.style.transform = 'scaleX(-1)'; // Mirror the remote video
    };

    // Send ICE candidates to the signaling server
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate:', event.candidate);
            sendMessage(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
        } else {
            console.log('All ICE candidates have been sent');
        }
    };

    // Log connection state changes
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state change:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            console.log('Connection failed or disconnected, attempting to reset...');
            handleDisconnect(); // Trigger reconnection logic
        }
    };

    // Log ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state change:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            console.log('ICE failed or disconnected. Attempting to reconnect...');
            handleDisconnect(); // Trigger reconnection logic
        }
    };
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
    console.log('Next button clicked, resetting connection...');
    handleDisconnect(); // Disconnect the current session

    // Reset WebRTC connection and signaling state
    statusMessage.textContent = 'Searching for a new peer...';
    
    // Reconnect WebSocket and start a fresh session
    initWebSocket();
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
    localVideo.srcObject = null;

    // Clear queued ICE candidates
    iceCandidatesQueue = [];

    // Notify the server that we have disconnected
    sendMessage(JSON.stringify({ type: 'disconnected' }));
}

// Process any ICE candidates that were queued
function processQueuedIceCandidates() {
    while (iceCandidatesQueue.length > 0) {
        const candidate = iceCandidatesQueue.shift();
        console.log('Processing queued ICE candidate:', candidate);
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
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