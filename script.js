const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startChatButton = document.getElementById('startChatButton');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');
const statusMessage = document.getElementById('statusMessage');

let localStream;
let peerConnection;
let isOfferer = false;
let iceCandidatesQueue = [];

const configuration = {
    iceServers: [
        { urls: 'stun:fr-turn1.xirsys.com' },
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

// WebSocket setup
const socket = new WebSocket('wss://blurd.adaptable.app');

socket.onopen = () => {
    console.log('WebSocket connected');
    startChatButton.disabled = false;  // Enable start button once WebSocket is ready
};

socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'connected') {
        isOfferer = data.isOfferer;
        startWebRTC();
    } else if (data.type === 'offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendMessage({ type: 'answer', answer: peerConnection.localDescription });
    } else if (data.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'ice-candidate') {
        if (peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
            iceCandidatesQueue.push(data.candidate);
        }
    } else if (data.type === 'blur-preference') {
        remoteWantsBlurOff = data.wantsBlurOff;
        updateBlurState();
    }
};

// Send signaling messages over WebSocket
function sendMessage(message) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        console.error('WebSocket is not open. ReadyState:', socket.readyState);
    }
}

// Access local media
startChatButton.addEventListener('click', async () => {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        toggleBlur(localVideo, true);  // Apply blur to local video
        statusMessage.textContent = 'Waiting for a peer...';
        sendMessage({ type: 'ready' });
    } catch (error) {
        console.error('Error accessing media devices:', error);
    }
});

async function startWebRTC() {
    if (!localStream) {
        console.error('Local stream is not available');
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            toggleBlur(localVideo, true);  // Apply blur to local video
        } catch (error) {
            console.error('Error accessing media devices:', error);
            return;
        }
    }

    peerConnection = new RTCPeerConnection(configuration);

    // Add local stream tracks to the peer connection
    if (localStream) { // Add this check
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    } else {
        console.error('Local stream is still not available');
        return;
    }

    // When the remote stream is received, display it
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        toggleBlur(remoteVideo, true);  // Apply blur to remote video
    };

    // Send ICE candidates to the other peer
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    // If we're the offerer, create and send an offer
    if (isOfferer) {
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => sendMessage({ type: 'offer', offer: peerConnection.localDescription }));
    }

    // Process any queued ICE candidates once the remote description is set
    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'connected') {
            iceCandidatesQueue.forEach(candidate => peerConnection.addIceCandidate(new RTCIceCandidate(candidate)));
            iceCandidatesQueue = [];
        }
    };
}

// Disconnect logic
disconnectButton.addEventListener('click', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    sendMessage({ type: 'disconnected' });
});

// Next button to reset the connection
nextButton.addEventListener('click', () => {
    disconnectButton.click(); // Trigger disconnect
    statusMessage.textContent = 'Searching for a new peer...';
    sendMessage({ type: 'ready' }); // Send ready again for a new connection
});

async function initializeCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        startWebRTC();
    } catch (error) {
        console.error('Error accessing media devices:', error);
    }
}

// Call this function when appropriate (e.g., when a "Start Call" button is clicked)
// initializeCall();

const localRemoveBlurButton = document.getElementById('localRemoveBlurButton');
const remoteRemoveBlurButton = document.getElementById('remoteRemoveBlurButton');

let localWantsBlurOff = false;
let remoteWantsBlurOff = false;

// Function to apply or remove blur filter
function toggleBlur(video, enabled) {
    video.style.filter = enabled ? 'blur(10px)' : 'none';
}

// Apply initial blur to both videos
function applyInitialBlur() {
    toggleBlur(localVideo, true);
    toggleBlur(remoteVideo, true);
}

// Call this function when the page loads and when the remote stream is added
applyInitialBlur();

// Toggle local blur preference
localRemoveBlurButton.addEventListener('click', () => {
    localWantsBlurOff = !localWantsBlurOff;
    sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
    updateBlurState();
});

// Function to update blur state based on both users' preferences
function updateBlurState() {
    const shouldRemoveBlur = localWantsBlurOff && remoteWantsBlurOff;
    toggleBlur(localVideo, !shouldRemoveBlur);
    toggleBlur(remoteVideo, !shouldRemoveBlur);
    
    localRemoveBlurButton.textContent = localWantsBlurOff ? "Re-enable Blur" : "Remove Blur";
    localRemoveBlurButton.style.backgroundColor = remoteWantsBlurOff ? "green" : "";
}

// Modify the existing socket.onmessage function
socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    // ... existing code ...

    if (data.type === 'blur-preference') {
        remoteWantsBlurOff = data.wantsBlurOff;
        updateBlurState();
    }

    // ... rest of the existing code ...
};

// Ensure the blur is applied when the connection is established
peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    applyInitialBlur();  // Apply blur to both videos when remote stream is added
};

// ... rest of the existing code ...

// Ensure the Remove Blur button is properly set up
const removeBlurButton = document.getElementById('removeBlurButton');
let localWantsBlurOff = false;

removeBlurButton.addEventListener('click', () => {
    localWantsBlurOff = !localWantsBlurOff;
    sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
    updateBlurState();
});

// Update the updateBlurState function
function updateBlurState() {
    const shouldRemoveBlur = localWantsBlurOff && remoteWantsBlurOff;
    toggleBlur(localVideo, !shouldRemoveBlur);
    toggleBlur(remoteVideo, !shouldRemoveBlur);
    
    removeBlurButton.textContent = localWantsBlurOff ? "Re-enable Blur" : "Remove Blur";
    removeBlurButton.style.backgroundColor = remoteWantsBlurOff ? "green" : "";
}

// Modify the peerConnection.ontrack event handler
peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    toggleBlur(remoteVideo, true);  // Apply blur to remote video
};

// ... rest of the existing code ...

// Make sure this code is placed after the DOM has fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const removeBlurButton = document.getElementById('removeBlurButton');
    let localWantsBlurOff = false;
    let remoteWantsBlurOff = false;

    if (removeBlurButton) {
        removeBlurButton.addEventListener('click', () => {
            localWantsBlurOff = !localWantsBlurOff;
            sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
            updateBlurState();
        });
    } else {
        console.error('Remove Blur button not found in the DOM');
    }

    function updateBlurState() {
        const shouldRemoveBlur = localWantsBlurOff && remoteWantsBlurOff;
        toggleBlur(localVideo, !shouldRemoveBlur);
        toggleBlur(remoteVideo, !shouldRemoveBlur);
        
        if (removeBlurButton) {
            removeBlurButton.textContent = localWantsBlurOff ? "Re-enable Blur" : "Remove Blur";
            removeBlurButton.style.backgroundColor = remoteWantsBlurOff ? "green" : "";
        }
    }

    // Modify the existing socket.onmessage function
    socket.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        // ... existing code ...

        if (data.type === 'blur-preference') {
            remoteWantsBlurOff = data.wantsBlurOff;
            updateBlurState();
        }

        // ... rest of the existing code ...
    };

    // Make sure toggleBlur function is defined
    function toggleBlur(video, enabled) {
        if (video) {
            video.style.filter = enabled ? 'blur(10px)' : 'none';
        }
    }
});

// ... rest of the existing code ...