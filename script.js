// Landing page elements
const localVideoPreview = document.getElementById('localVideoPreview');
const toggleBlurButton = document.getElementById('toggleBlurButton');
const usernameInput = document.getElementById('usernameInput');
const termsCheckbox = document.getElementById('termsCheckbox');
const startChatButton = document.getElementById('startChatButton');

// Chat interface elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');
const statusMessage = document.getElementById('statusMessage');
const removeBlurButton = document.getElementById('removeBlurButton');
const toggleAudioButton = document.getElementById('toggleAudioButton');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendMessageButton');
const chatMessages = document.getElementById('chatMessages');

// Variables
let localStream;
let peerConnection;
let isOfferer = false;
let iceCandidatesQueue = [];
let makingOffer = false;
let ignoreOffer = false;
let polite = false; // Will be set based on your role
let isBlurred = true; // For preview
let localWantsBlurOff = false;
let remoteWantsBlurOff = false;
let isConnectedToPeer = false;
let dataChannel;
let isAudioEnabled = false;
let username = '';

// WebSocket setup
let socket;
let socketReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let heartbeatInterval;
let intentionalDisconnect = false; // Added flag to track intentional disconnects

// Landing Page Functions
async function setupLocalPreview() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        localVideoPreview.srcObject = localStream;
        applyBlurEffectPreview();
        console.log('Camera accessed successfully for preview');
    } catch (error) {
        console.error('Error accessing camera:', error);
        alert('Unable to access camera. Please ensure you have given permission and try again.');
    }
}

function applyBlurEffectPreview() {
    localVideoPreview.style.filter = isBlurred ? 'blur(10px)' : 'none';
}

toggleBlurButton.addEventListener('click', () => {
    isBlurred = !isBlurred;
    applyBlurEffectPreview();
});

function updateStartChatButton() {
    startChatButton.disabled = !(usernameInput.value.trim() && termsCheckbox.checked);
    console.log('Start Chat button state updated:', !startChatButton.disabled);
}

usernameInput.addEventListener('input', updateStartChatButton);
termsCheckbox.addEventListener('change', updateStartChatButton);

startChatButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username && termsCheckbox.checked) {
        localStorage.setItem('username', username);
        startChat();
    }
});

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded');
    setupLocalPreview();
    updateStartChatButton(); // Initial check
});

// Chat Initialization Functions
async function initializeChat() {
    console.log('Initializing chat');
    try {
        await initializeConnection();
        console.log('Connection initialized successfully');
        setupChat();
        console.log('Chat setup complete');
    } catch (error) {
        console.error('Error in initializeChat:', error);
    }
}

async function initializeConnection() {
    console.log('Initializing connection');
    try {
        const constraints = { video: true, audio: true };
        try {
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (audioError) {
            console.warn('Audio device not found, trying video only');
            constraints.audio = false;
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
        }
        
        localVideo.srcObject = localStream;
        console.log('Local stream set up successfully');
        console.log('Local stream tracks:', localStream.getTracks().map(t => t.kind));
        
        // Start the WebSocket connection after getting the local stream
        setupWebSocket();
    } catch (error) {
        console.error('Error setting up local stream:', error);
        handleMediaError(error);
    }
}

function handleMediaError(error) {
    let errorMessage = '';
    switch(error.name) {
        case 'NotFoundError':
            errorMessage = 'Camera or microphone not found. Please ensure your devices are connected and permissions are granted.';
            break;
        case 'NotAllowedError':
            errorMessage = 'Permission to use camera and microphone was denied. Please allow access and try again.';
            break;
        case 'NotReadableError':
            errorMessage = 'Your camera or microphone is already in use by another application.';
            break;
        default:
            errorMessage = `An error occurred while trying to access your camera and microphone: ${error.message}`;
    }
    console.error(errorMessage);
    alert(errorMessage);
    // You might want to update the UI to reflect this error state
}

const configuration = {
    iceServers: [
        {
            urls: ["stun:fr-turn1.xirsys.com"]
        },
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

function createPeerConnection() {
    console.log('Creating peer connection');
    peerConnection = new RTCPeerConnection(configuration);
    
    peerConnection.onicecandidate = handleICECandidate;
    peerConnection.ontrack = handleTrack;
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected') {
            console.log('ICE connected, forcing video play');
            remoteVideo.play().catch(e => console.error('Error forcing video play:', e));
        }
    };
    peerConnection.onsignalingstatechange = () => {
        console.log('Signaling state:', peerConnection.signalingState);
    };
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log('Adding local track to peer connection:', track.kind);
            peerConnection.addTrack(track, localStream);
        });
    } else {
        console.warn('No local stream available when creating peer connection');
    }

    console.log('Peer connection created');
}

function setupWebSocket() {
    socket = new WebSocket('wss://blurd.adaptable.app');
    
    socket.onopen = () => {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
        // Send any necessary initialization messages
        sendMessage({ type: 'ready', username: username });
    };
    
    socket.onclose = (event) => {
        console.log('WebSocket disconnected, attempting to reconnect...');
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            setTimeout(setupWebSocket, 5000);
            reconnectAttempts++;
        } else {
            console.error('Max reconnection attempts reached');
            updateUIConnectionState('Connection failed');
        }
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    
    socket.onmessage = handleIncomingMessage;
}

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (document.visibilityState === 'visible' && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
        }
    }, 15000); // Every 15 seconds
}

function sendMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        message.username = username;
        socket.send(JSON.stringify(message));
        console.log('Sent message:', message);
    } else {
        console.log('WebSocket not ready. Message not sent:', message);
    }
}

function handleIncomingMessage(event) {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);

    switch (data.type) {
        case 'waiting':
            updateUIConnectionState('Waiting for peer...');
            break;
        case 'paired':
            console.log('Paired with peer, isOfferer:', data.isOfferer);
            updateUIConnectionState('Connected to peer');
            startConnection(data.isOfferer);
            break;
        case 'offer':
            console.log('Received offer');
            handleOfferOrAnswer(data.offer, true);
            break;
        case 'answer':
            console.log('Received answer');
            handleOfferOrAnswer(data.answer, false);
            break;
        case 'candidate':
            console.log('Received ICE candidate');
            handleNewICECandidate(data.candidate);
            break;
        case 'chat':
            addMessageToChat('Partner', data.message);
            break;
        case 'pong':
            // Handle pong (if needed)
            break;
        case 'partnerDisconnected':
            handlePartnerDisconnect();
            break;
        default:
            console.warn('Unknown message type:', data.type);
    }
}

function updateUIConnectionState(state) {
    const stateElement = document.getElementById('connectionState');
    if (stateElement) {
        stateElement.textContent = state;
    } else {
        console.warn('Connection state element not found, state:', state);
    }
}

// Peer Connection and RTC Functions
function startConnection(isOfferer) {
    console.log('Starting connection, isOfferer:', isOfferer);
    createPeerConnection();
    
    if (isOfferer) {
        console.log('Creating offer');
        peerConnection.createOffer()
            .then(offer => {
                console.log('Setting local description (offer)');
                return peerConnection.setLocalDescription(offer);
            })
            .then(() => {
                console.log('Sending offer');
                sendMessage({ type: 'offer', offer: peerConnection.localDescription });
            })
            .catch(error => console.error('Error creating offer:', error));
    }
}

function handleOfferOrAnswer(description, isOffer) {
    console.log(`Handling ${isOffer ? 'offer' : 'answer'}:`, description);
    peerConnection.setRemoteDescription(new RTCSessionDescription(description))
        .then(() => {
            console.log('Set remote description successfully');
            if (isOffer) {
                console.log('Creating answer');
                return peerConnection.createAnswer();
            }
        })
        .then(answer => {
            if (answer) {
                console.log('Setting local description (answer)');
                return peerConnection.setLocalDescription(answer);
            }
        })
        .then(() => {
            if (isOffer) {
                console.log('Sending answer');
                sendMessage({ type: 'answer', answer: peerConnection.localDescription });
            }
        })
        .catch(error => console.error('Error in handleOfferOrAnswer:', error));
}

function handleNewICECandidate(candidate) {
    console.log('Received ICE candidate:', candidate);
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        .then(() => console.log('Added ICE candidate successfully'))
        .catch(error => console.error('Error adding ICE candidate:', error));
}

function handleICECandidate(event) {
    if (event.candidate) {
        console.log('Sending ICE candidate:', event.candidate);
        sendMessage({ type: 'candidate', candidate: event.candidate });
    } else {
        console.log('All ICE candidates have been sent');
    }
}

function handleTrack(event) {
    console.log('Received remote track:', event.track.kind);
    console.log('Remote streams:', event.streams);
    if (!remoteVideo.srcObject) {
        remoteVideo.srcObject = event.streams[0];
        console.log('Set remote video source');
        event.streams[0].onaddtrack = (e) => console.log('New track added to remote stream:', e.track.kind);
        
        remoteVideo.onloadedmetadata = () => {
            console.log('Remote video metadata loaded');
            console.log('Remote video dimensions:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
            remoteVideo.play().then(() => {
                console.log('Remote video playing successfully');
            }).catch(e => console.error('Error playing remote video:', e));
        };
    } else {
        console.log('Remote video source already set');
    }
    remoteVideo.onplay = () => console.log('Remote video started playing');
    remoteVideo.oncanplay = () => console.log('Remote video can play');
    remoteVideo.onerror = (e) => console.error('Remote video error:', e);
}

// Chat Functions
function setupChat() {
    console.log('Setting up chat');

    if (chatInput && sendButton && chatMessages) {
        sendButton.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                sendChatMessage();
            }
        });
    } else {
        console.error('Some chat elements are missing');
    }

    toggleAudioButton.addEventListener('click', toggleAudio);
    nextButton.addEventListener('click', handleNext);
    disconnectButton.addEventListener('click', handleDisconnect);
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (message) {
        sendMessage({ type: 'chat', message: message });
        addMessageToChat('You', message);
        chatInput.value = '';
    } else {
        console.log('Empty message, not sending');
    }
}

function addMessageToChat(sender, message) {
    const messageElement = document.createElement('div');
    
    if (sender === 'System') {
        messageElement.style.fontStyle = 'italic';
        messageElement.style.color = '#888';
    }
    
    messageElement.textContent = `${sender === 'System' ? '' : sender + ': '}${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearChat() {
    if (chatMessages) {
        chatMessages.innerHTML = '';
    } else {
        console.error('Chat messages element not found');
    }
}

function resetBlurState() {
    remoteWantsBlurOff = false;
    updateBlurState();
}

function updateBlurState() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');

    if (localWantsBlurOff) {
        localVideo.style.filter = 'none';
    } else {
        localVideo.style.filter = 'blur(10px)';
    }

    if (remoteWantsBlurOff) {
        remoteVideo.style.filter = 'none';
    } else {
        remoteVideo.style.filter = 'blur(10px)';
    }

    console.log('Blur state updated');
}

function toggleBlur() {
    console.log('Toggle blur called');
    if (!removeBlurButton || removeBlurButton.disabled || !peerConnection || !dataChannel || dataChannel.readyState !== 'open') {
        console.log('Remove blur button is disabled, not found, or data channel not ready');
        return;
    }
    localWantsBlurOff = !localWantsBlurOff;
    console.log('Local wants blur off:', localWantsBlurOff);
    updateBlurState();
    sendBlurState();
}

function sendBlurState() {
    if (dataChannel && dataChannel.readyState === 'open') {
        const message = JSON.stringify({ type: 'blurState', blurState: localWantsBlurOff });
        dataChannel.send(message);
        console.log('Sent blur state:', message);
    } else {
        console.log('Data channel is not open. Cannot send blur state.');
    }
}

// Audio Control Functions
function toggleAudio() {
    if (localStream) {
        isAudioEnabled = !isAudioEnabled;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = isAudioEnabled;
        });
        toggleAudioButton.textContent = isAudioEnabled ? 'Disable Audio' : 'Enable Audio';
        notifyAudioStateChange();
    }
}

function notifyAudioStateChange() {
    sendMessage({ type: 'audio-state', enabled: isAudioEnabled });
}

// Connection Control Functions
function handlePartnerDisconnect() {
    if (!isConnectedToPeer) return;
    isConnectedToPeer = false;
    console.log('Handling partner disconnect');

    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onsignalingstatechange = null;
        peerConnection.onnegotiationneeded = null;

        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo) {
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
    }
    // Reset blur state
    remoteWantsBlurOff = false;
    updateBlurState();
    console.log('Disconnected from peer');

    // Automatically attempt to find a new partner
    intentionalDisconnect = false; // Ensure the flag is false
    sendMessage({ type: 'ready' });
}

function handleNext() {
    console.log('Next button clicked');
    clearChat();
    resetBlurState();
    sendMessage({ type: 'next' });
    handlePartnerDisconnect();
    // Do not close the WebSocket
}

function handleDisconnect() {
    console.log('Disconnect button clicked');
    clearChat();
    intentionalDisconnect = true;
    sendMessage({ type: 'disconnected' });
    handlePartnerDisconnect();
    if (socket) socket.close(); // Close the WebSocket only on full disconnect
}

function updateConnectionStatus() {
    if (peerConnection && peerConnection.iceConnectionState === 'connected') {
        statusMessage.textContent = 'Connected to a peer';
    } else {
        statusMessage.textContent = 'Waiting for peer...';
    }
}

window.onbeforeunload = () => {
    if (peerConnection) peerConnection.close();
    if (socket) socket.close();
};

function startChat() {
    const landingPage = document.getElementById('landingPage');
    const chatPage = document.getElementById('chatPage');
    const usernameInput = document.getElementById('usernameInput');

    // Capture the username
    username = usernameInput.value || 'Anonymous';

        // Apply fade-out animation to landing page
        landingPage.classList.add('fade-out');

        // After the fade-out animation completes, hide the landing page and show the chat page
        setTimeout(() => {
            landingPage.style.display = 'none';
            landingPage.classList.remove('fade-out');
    
            // Show the chat page and apply fade-in animation
            chatPage.style.display = 'block';
            chatPage.classList.add('fade-in');
    
            // Remove the fade-in class after the animation completes to reset the state
            setTimeout(() => {
                chatPage.classList.remove('fade-in');
            }, 500); // Match the duration of the fade-in animation
    
            // Proceed with initializing the chat functionalities
            initializeChat();
        }, 500); // Match the duration of the fade-out animation
    }


function setupBlurEffect() {
    console.log('Setting up blur effect');
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const removeBlurButton = document.getElementById('removeBlurButton');

    if (!localVideo || !remoteVideo || !removeBlurButton) {
        console.error('Video elements or remove blur button not found');
        return;
    }

    // Apply initial blur
    localVideo.style.filter = 'blur(10px)';
    remoteVideo.style.filter = 'blur(10px)';

    removeBlurButton.addEventListener('click', toggleBlur);
    console.log('Blur effect setup complete');
}

function restartIce() {
    if (peerConnection) {
        console.log('Restarting ICE connection');
        peerConnection.restartIce();
        peerConnection.createOffer({ iceRestart: true })
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                sendMessage({ type: 'offer', offer: peerConnection.localDescription });
            })
            .catch(error => console.error('Error during ICE restart:', error));
    }
}

// Call this function if the ICE connection state becomes 'failed'
peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'failed') {
        console.log('ICE connection failed, attempting restart');
        restartIce();
    }
};

function checkConnectionStatus() {
    if (peerConnection) {
        console.log('Connection status:', peerConnection.connectionState);
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        console.log('Signaling state:', peerConnection.signalingState);
    }
}

function checkRelayConnection() {
    if (peerConnection) {
        peerConnection.getStats(null).then(stats => {
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    console.log('Active candidate pair:', report);
                    if (report.remoteCandidateType === 'relay' || report.localCandidateType === 'relay') {
                        console.log('Connection is using a relay (TURN) server');
                    } else {
                        console.log('Connection is not using a relay');
                    }
                }
            });
        });
    }
}

// Call this function periodically
setInterval(checkConnectionStatus, 30000);
setInterval(checkRelayConnection, 30000);

function checkRemoteVideoState() {
    console.log('Remote video ready state:', remoteVideo.readyState);
    console.log('Remote video paused:', remoteVideo.paused);
    console.log('Remote video current time:', remoteVideo.currentTime);
    console.log('Remote video src:', remoteVideo.src);
    console.log('Remote video srcObject:', remoteVideo.srcObject);
}

// Call this function every 5 seconds after the peer connection is established
setInterval(checkRemoteVideoState, 5000);

function tryPlayRemoteVideo() {
    if (remoteVideo.paused) {
        remoteVideo.play().then(() => {
            console.log('Remote video play() succeeded');
        }).catch(error => {
            console.error('Remote video play() failed:', error);
        });
    } else {
        console.log('Remote video is already playing');
    }
}

// Call this function a few seconds after the peer connection is established
setTimeout(tryPlayRemoteVideo, 5000);

function checkVideoStatus() {
    console.log('Video ready state:', remoteVideo.readyState);
    console.log('Video network state:', remoteVideo.networkState);
    console.log('Video paused:', remoteVideo.paused);
    console.log('Video currentTime:', remoteVideo.currentTime);
    console.log('Video duration:', remoteVideo.duration);
    console.log('Video ended:', remoteVideo.ended);
    console.log('Video muted:', remoteVideo.muted);
    console.log('Video volume:', remoteVideo.volume);
    console.log('Video width x height:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
}

setInterval(checkVideoStatus, 5000);

