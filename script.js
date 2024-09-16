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
let socket;
let socketReady = false;

function setupWebSocket() {
    socket = new WebSocket('wss://blurd.adaptable.app');

    socket.onopen = () => {
        console.log('WebSocket connected');
        socketReady = true;
        startChat();
    };

    socket.onclose = () => {
        console.log('WebSocket disconnected. Attempting to reconnect...');
        socketReady = false;
        setTimeout(setupWebSocket, 5000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    socket.onmessage = handleIncomingMessage;
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', () => {
    setupWebSocket();
    setupChat();
    setupUIElements();
});

function setupUIElements() {
    const toggleBlurButton = document.getElementById('toggleBlurButton');
    if (toggleBlurButton) {
        toggleBlurButton.addEventListener('click', toggleBlur);
    } else {
        console.error('Toggle blur button not found');
    }

    // Add other UI element setups here
}

function setupChat() {
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendMessageButton');
    
    if (chatInput && sendButton) {
        sendButton.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                sendChatMessage();
            }
        });
    } else {
        console.error('Chat elements not found');
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    if (message) {
        sendMessage({ type: 'chat', message: message });
        addMessageToChat('You', message);
        chatInput.value = '';
    }
}

function handleIncomingMessage(event) {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);

    switch(data.type) {
        case 'ready':
            if (!peerConnection) {
                createPeerConnection();
            }
            peerConnection.createOffer()
                .then(offer => peerConnection.setLocalDescription(offer))
                .then(() => {
                    sendMessage({ type: 'offer', offer: peerConnection.localDescription });
                });
            break;
        case 'offer':
            if (!peerConnection) {
                createPeerConnection();
            }
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))
                .then(() => peerConnection.createAnswer())
                .then(answer => peerConnection.setLocalDescription(answer))
                .then(() => {
                    sendMessage({ type: 'answer', answer: peerConnection.localDescription });
                });
            break;
        case 'answer':
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            break;
        case 'ice-candidate':
            try {
                peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                console.error('Error adding received ice candidate', e);
            }
            break;
        case 'chat':
            addMessageToChat('Peer', data.message);
            break;
        case 'blur-preference':
            remoteWantsBlurOff = data.wantsBlurOff;
            updateBlurState();
            break;
    }
}

function sendMessage(message) {
    if (socketReady) {
        socket.send(JSON.stringify(message));
        console.log('Message sent:', message);
    } else {
        console.error('WebSocket is not ready. Message not sent:', message);
        setTimeout(() => sendMessage(message), 1000); // Retry after 1 second
    }
}

function startChat() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = localStream;
                toggleBlur(localVideo, true);
            } else {
                console.error('Local video element not found');
            }
            createPeerConnection();
            sendMessage({ type: 'ready' });
        })
        .catch(error => {
            console.error('Error accessing media devices:', error);
            updateStatus('Error accessing media devices');
        });
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected') {
            console.log('Peer disconnected. Attempting to reconnect...');
            startChat();
        }
    };

    peerConnection.ontrack = event => {
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
            remoteVideo.srcObject = event.streams[0];
            toggleBlur(remoteVideo, true);
        }
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    console.log('Peer connection created');
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

const localRemoveBlurButton = document.getElementById('localRemoveBlurButton');
const remoteRemoveBlurButton = document.getElementById('remoteRemoveBlurButton');

let localWantsBlurOff = false;
let remoteWantsBlurOff = false;

// Function to apply or remove blur filter
function toggleBlur(video, enabled) {
    if (video) {
        video.style.filter = enabled ? 'blur(10px)' : 'none';
    } else {
        console.error('Video element not found for blur toggle');
    }
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

// Ensure the blur is applied when the connection is established
peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    applyInitialBlur();  // Apply blur to both videos when remote stream is added
};

// Ensure the Remove Blur button is properly set up
const removeBlurButton = document.getElementById('removeBlurButton');

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

// Make sure this code is placed after the DOM has fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const removeBlurButton = document.getElementById('removeBlurButton');
    let localWantsBlurOff = false;
    let remoteWantsBlurOff = false;

    console.log('DOM fully loaded');

    function toggleBlur(video, enabled) {
        if (video) {
            video.style.filter = enabled ? 'blur(10px)' : 'none';
            console.log(`Blur ${enabled ? 'applied to' : 'removed from'} ${video.id}`);
        } else {
            console.error('Video element not found');
        }
    }

    function updateBlurState() {
        console.log('Updating blur state');
        console.log('Local wants blur off:', localWantsBlurOff);
        console.log('Remote wants blur off:', remoteWantsBlurOff);
        
        const shouldRemoveBlur = localWantsBlurOff && remoteWantsBlurOff;
        toggleBlur(localVideo, !shouldRemoveBlur);
        toggleBlur(remoteVideo, !shouldRemoveBlur);
        
        if (removeBlurButton) {
            removeBlurButton.textContent = localWantsBlurOff ? "Re-enable Blur" : "Remove Blur";
            removeBlurButton.style.backgroundColor = remoteWantsBlurOff ? "green" : "";
            console.log('Button updated:', removeBlurButton.textContent);
        } else {
            console.error('Remove Blur button not found');
        }
    }

    if (removeBlurButton) {
        removeBlurButton.addEventListener('click', () => {
            console.log('Remove Blur button clicked');
            localWantsBlurOff = !localWantsBlurOff;
            console.log('Local wants blur off:', localWantsBlurOff);
            sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
            updateBlurState();
        });
        console.log('Event listener added to Remove Blur button');
    } else {
        console.error('Remove Blur button not found in the DOM');
    }

    // Apply initial blur
    toggleBlur(localVideo, true);
    toggleBlur(remoteVideo, true);
});

// Make sure this function is defined in the global scope
function sendMessage(message) {
    console.log('sendMessage function called with:', message);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        console.log('Message sent via WebSocket:', message);
    } else {
        console.error('WebSocket is not open. ReadyState:', socket ? socket.readyState : 'socket not initialized');
    }
}

// Function to toggle blur
function toggleBlur() {
    console.log('Toggle blur function called');
    localWantsBlurOff = !localWantsBlurOff;
    sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
    updateBlurState();
}

// Function to update blur state
function updateBlurState() {
    console.log('Updating blur state');
    console.log('Local wants blur off:', localWantsBlurOff);
    console.log('Remote wants blur off:', remoteWantsBlurOff);
    
    const shouldRemoveBlur = localWantsBlurOff && remoteWantsBlurOff;
    applyBlur(localVideo, !shouldRemoveBlur);
    applyBlur(remoteVideo, !shouldRemoveBlur);
    
    const toggleBlurButton = document.getElementById('toggleBlurButton');
    if (toggleBlurButton) {
        toggleBlurButton.textContent = localWantsBlurOff ? "Re-enable Blur" : "Remove Blur";
        toggleBlurButton.style.backgroundColor = remoteWantsBlurOff ? "green" : "";
        console.log('Button updated:', toggleBlurButton.textContent);
    } else {
        console.error('Toggle Blur button not found');
    }
}

// Function to apply or remove blur
function applyBlur(video, enabled) {
    if (video) {
        video.style.filter = enabled ? 'blur(10px)' : 'none';
        console.log(`Blur ${enabled ? 'applied to' : 'removed from'} ${video.id}`);
    } else {
        console.error('Video element not found');
    }
}

// Apply initial blur when the page loads
window.onload = function() {
    applyBlur(localVideo, true);
    applyBlur(remoteVideo, true);
    console.log('Initial blur applied');
};

function updateStatus(message) {
    const statusMessage = document.getElementById('statusMessage');
    if (statusMessage) {
        statusMessage.textContent = message;
    } else {
        console.error('Status message element not found');
    }
}
