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
let peerConnection = null;
let isOfferer = false;
let iceCandidatesQueue = [];
let makingOffer = false;
let ignoreOffer = false;
let polite = false; // Will be set based on your role
let isBlurred = true; // For preview
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
    if (peerConnection) {
        console.log('Closing existing peer connection');
        peerConnection.close();
    }
    try {
        peerConnection = new RTCPeerConnection(configuration);
        console.log('Peer connection created successfully:', peerConnection);

        peerConnection.onicecandidate = handleICECandidate;
        peerConnection.ontrack = handleTrack;
        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state changed:', peerConnection.iceConnectionState);
            if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
                console.log('ICE connected, attempting to play remote video');
                playRemoteVideo();
            } else if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'closed') {
                console.log('ICE connection lost, cleaning up');
                cleanupConnection();
            }
        };
        peerConnection.onsignalingstatechange = () => {
            console.log('Signaling state changed:', peerConnection.signalingState);
        };
        peerConnection.onconnectionstatechange = () => {
            console.log('Connection state changed:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
                console.log('Connection lost, cleaning up');
                cleanupConnection();
            }
        };

        peerConnection.ondatachannel = (event) => {
            console.log('Received data channel from peer');
            dataChannel = event.channel;
            setupDataChannel(dataChannel);
        };

        // For the offerer
        if (!dataChannel) {
            console.log('Creating data channel (offerer)');
            dataChannel = peerConnection.createDataChannel('chat');
            setupDataChannel(dataChannel);
        }

        peerConnection.onicegatheringstatechange = () => {
            console.log('ICE gathering state changed:', peerConnection.iceGatheringState);
        };

        peerConnection.onicecandidateerror = (event) => {
            console.error('ICE candidate error:', event);
        };

        return peerConnection;
    } catch (error) {
        console.error('Error creating peer connection:', error);
        return null;
    }
}

function setupWebSocket() {
    socket = new WebSocket('wss://blurd.adaptable.app');
    
    socket.onopen = () => {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
        // Send any necessary initialization messages
        sendMessage({ type: 'ready', username: username });
        startHeartbeat()
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

let isConnecting = false;
let iceCandidateQueue = [];
let offerQueue = null;

function handleIncomingMessage(event) {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);

    switch (data.type) {
        case 'paired':
            if (!isConnecting) {
                isConnecting = true;
                initializeConnection(data.isOfferer);
            } else {
                console.log('Connection already in progress, ignoring pairing message');
            }
            break;
        case 'answer':
            console.log('Received answer');
            handleAnswerMessage(data.answer);
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
            console.log('Partner disconnected');
            cleanupConnection();
            break;
        case 'waiting':
            console.log('Server indicates waiting for a peer.');
            updateUIConnectionState('Waiting for a peer...');
            break;
        default:
            console.warn('Unknown message type:', data.type);
    }
}

function sendMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        console.log('WebSocket not ready, queueing message:', message);
        if (message.type === 'candidate') {
            iceCandidateQueue.push(message.candidate);
        } else if (message.type === 'offer') {
            offerQueue = message.offer;
        }
    }
}

function onWebSocketOpen() {
    console.log('WebSocket connected');
    sendQueuedMessages();
}

function sendQueuedMessages() {
    while (iceCandidateQueue.length > 0) {
        sendMessage({ type: 'candidate', candidate: iceCandidateQueue.shift() });
    }
    if (offerQueue) {
        sendMessage({ type: 'offer', offer: offerQueue });
        offerQueue = null;
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
    peerConnection = createPeerConnection();
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                peerConnection.addTrack(track, localStream);
            } catch (error) {
                console.error('Error adding track to peer connection:', error);
            }
        });
    } else {
        console.error('Local stream is not available');
    }

    if (isOfferer) {
        dataChannel = peerConnection.createDataChannel('chat');
        setupDataChannel(dataChannel);
    } else {
        // For the answerer
        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel);
        };
    }
}

function createAndSendOffer() {
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            sendMessage({ type: 'offer', offer: peerConnection.localDescription });
        })
        .catch(error => console.error('Error creating offer:', error));
}

function handleOfferMessage(offer) {
    if (!peerConnection) {
        startConnection(false);
    }
    peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => {
            applyQueuedCandidates(); // Add this line
            return peerConnection.createAnswer();
        })
        .then(answer => peerConnection.setLocalDescription(answer))
        .then(() => {
            sendMessage({ type: 'answer', answer: peerConnection.localDescription });
        })
        .catch(error => console.error('Error handling offer:', error));
}
function handleAnswerMessage(answer) {
    peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
        .then(() => {
            applyQueuedCandidates(); // Add this line
        })
        .catch(error => console.error('Error handling answer:', error));
}

function handleNewICECandidate(candidate) {
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(error => console.error('Error adding ICE candidate:', error));
    } else {
        iceCandidatesQueue.push(candidate);
    }
}

function handleICECandidate(event) {
    if (event.candidate) {
        console.log('Sending ICE candidate');
        sendMessage({
            type: 'candidate',
            candidate: event.candidate
        });
    } else {
        console.log('All ICE candidates have been sent');
    }
}

function handleTrack(event) {
    console.log('Handling track event:', event);
    if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        console.log('Remote stream received:', stream);
        if (remoteVideo) {
            remoteVideo.srcObject = stream;
            console.log('Set remote video source');
            remoteVideo.onloadedmetadata = () => {
                console.log('Remote video metadata loaded');
                console.log('Remote video dimensions:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
                // Instead of immediately playing, we'll wait a short time
                setTimeout(playRemoteVideo, 100);
            };
            remoteVideo.onerror = (e) => console.error('Remote video error:', e);
            
            // Add this to check if the stream has video tracks
            const videoTracks = stream.getVideoTracks();
            console.log('Remote stream video tracks:', videoTracks);
            if (videoTracks.length > 0) {
                console.log('Remote video track settings:', videoTracks[0].getSettings());
            } else {
                console.warn('No video tracks found in the remote stream');
            }
        } else {
            console.error('Remote video element not found');
        }
    } else {
        console.error('No streams found in track event');
    }
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
    setupBlurEffect();
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (message && dataChannel && dataChannel.readyState === 'open') {
        const chatMessage = JSON.stringify({ type: 'chatMessage', content: message });
        dataChannel.send(chatMessage);
        addMessageToChat('You', message);
        chatInput.value = '';
    } else {
        console.log('Data channel not open or empty message');
    }
}

function addMessageToChat(sender, message) {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        const messageElement = document.createElement('div');
        messageElement.textContent = `${sender}: ${message}`;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
        console.error('Chat messages container not found');
    }
}

function clearChat() {
    if (chatMessages) {
        chatMessages.innerHTML = '';
    } else {
        console.error('Chat messages element not found');
    }
}

// Apply Blur Effect
function applyBlurEffect() {
    const filterValue = isBlurred ? 'blur(10px)' : 'none';
    localVideo.style.filter = filterValue;
    remoteVideo.style.filter = filterValue;
    console.log('Applied blur effect:', filterValue);

    // Update the remove blur button
    if (isBlurred) {
        removeBlurButton.disabled = false;
        removeBlurButton.textContent = 'Remove Blur';
    } else {
        removeBlurButton.disabled = true;
        removeBlurButton.textContent = 'Blur Removed';
    }
}

function resetBlurState() {
    isBlurred = true; // Reset blur to true
    applyBlurEffect(); // Apply the initial blur
    if (removeBlurButton) {
        removeBlurButton.disabled = false;
        removeBlurButton.textContent = 'Remove Blur';
    }
}

function updateBlurState() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');

    localVideo.style.filter = localWantsBlurOff && remoteWantsBlurOff ? 'none' : 'blur(10px)';
    remoteVideo.style.filter = localWantsBlurOff && remoteWantsBlurOff ? 'none' : 'blur(10px)';

    console.log('Blur state updated');
}

// Toggle Blur
function toggleBlur() {
    if (dataChannel && dataChannel.readyState === 'open') {
        isBlurred = false; // Update local state
        applyBlurEffect(); // Apply the new blur state
        sendBlurState(); // Notify the peer
        console.log('Blur removed locally and notified peer');
    } else {
        console.error('Data channel is not open. Cannot remove blur.');
    }
}

// Send Blur State
function sendBlurState() {
    if (dataChannel && dataChannel.readyState === 'open') {
        const message = JSON.stringify({ type: 'blurState', isBlurred: isBlurred });
        dataChannel.send(message);
        console.log('Sent blur state to peer:', message);
    } else {
        console.error('Data channel is not open. Cannot send blur state.');
    }
}

// Handle Blur State Message
function handleBlurStateMessage(peerBlurState) {
    console.log('Received peer blur state:', peerBlurState);
    isBlurred = peerBlurState; // Update local blur state to match peer
    applyBlurEffect(); // Apply the new blur state

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
function cleanupConnection() {
    if (peerConnection) {
        peerConnection.getSenders().forEach(sender => {
            peerConnection.removeTrack(sender);
        });
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onsignalingstatechange = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo) {
        remoteVideo.pause();
        remoteVideo.srcObject = null;
    }
    updateUIConnectionState('Disconnected');
}

function handleNext() {
    console.log('Next button clicked');
    clearChat();
    resetBlurState();
    sendMessage({ type: 'next' });
    cleanupConnection();
    // Do not close the WebSocket
}

function handleDisconnect() {
    console.log('Disconnect button clicked');
    clearChat();
    resetBlurState();
    intentionalDisconnect = true;
    sendMessage({ type: 'disconnected' });
    cleanupConnection();
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
        applyBlurEffect(); // Apply initial blur to both videos
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
    if (remoteVideo) {
        console.log('Remote video state:',
            'readyState:', remoteVideo.readyState,
            'networkState:', remoteVideo.networkState,
            'paused:', remoteVideo.paused,
            'currentTime:', remoteVideo.currentTime,
            'ended:', remoteVideo.ended,
            'muted:', remoteVideo.muted,
            'volume:', remoteVideo.volume,
            'dimensions:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight
        );
        
        if (remoteVideo.srcObject) {
            const videoTracks = remoteVideo.srcObject.getVideoTracks();
            console.log('Remote video tracks:', videoTracks);
            if (videoTracks.length > 0) {
                console.log('Remote video track enabled:', videoTracks[0].enabled);
                console.log('Remote video track settings:', videoTracks[0].getSettings());
            }
        }
    } else {
        console.error('Remote video element not found');
    }
}

// Call this function every 5 seconds after connection is established
setInterval(checkRemoteVideoState, 5000);

function playRemoteVideo() {
    if (remoteVideo && remoteVideo.paused) {
        console.log('Attempting to play remote video');
        remoteVideo.play().then(() => {
            console.log('Remote video playing successfully');
        }).catch(e => {
            console.error('Error playing remote video:', e.name, e.message);
            if (e.name === 'NotAllowedError') {
                console.log('Autoplay prevented. User interaction required to play video.');
            } else if (e.name === 'AbortError') {
                console.log('Play request was interrupted. Retrying in 1 second.');
                setTimeout(playRemoteVideo, 1000);
            }
        });
    } else if (!remoteVideo) {
        console.error('Remote video element not found');
    } else {
        console.log('Remote video is already playing');
    }
}

// Call this function a few seconds after the peer connection is established
setTimeout(playRemoteVideo, 5000);

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

function logActivePeerConnections() {
    if (typeof RTCPeerConnection !== 'undefined') {
        console.log('Active RTCPeerConnections:', RTCPeerConnection.generateCertificate ? RTCPeerConnection.generateCertificate.length : 'Unknown');
    } else {
        console.log('RTCPeerConnection is not supported in this browser');
    }
}

// Call this function every 10 seconds
setInterval(logActivePeerConnections, 10000);

function logPeerConnectionState() {
    if (peerConnection) {
        console.log('Peer Connection State:', peerConnection.connectionState);
        console.log('ICE Connection State:', peerConnection.iceConnectionState);
        console.log('Signaling State:', peerConnection.signalingState);
        console.log('Number of senders:', peerConnection.getSenders().length);
        console.log('Number of receivers:', peerConnection.getReceivers().length);
    } else {
        console.log('No active peer connection');
    }
}

// Call this function every 5 seconds
setInterval(logPeerConnectionState, 5000);

function setupDataChannel(channel) {
    console.log('Setting up data channel');
    channel.onopen = () => {
        console.log('Data channel opened');
        sendBlurState(); // Send initial blur state
    };
    channel.onmessage = (event) => {
        console.log('Received message on data channel:', event.data);
        const message = JSON.parse(event.data);
        if (message.type === 'blurState') {
            handleBlurStateMessage(message.isBlurred);
        } else if (message.type === 'chatMessage') {
            addMessageToChat('Partner', message.content);
        }
    };
    function handleBlurStateMessage(peerBlurState) {
        console.log('Received peer blur state:', peerBlurState);
        isBlurred = peerBlurState; // Update local blur state to match peer
        applyBlurEffect(); // Apply the blur state
        if (!isBlurred) {
            removeBlurButton.disabled = true; // Disable the button if blur is removed
            removeBlurButton.textContent = 'Blur Removed';
        };
        channel.onclose = () => console.log('Data channel closed');
        channel.onerror = (error) => console.error('Data channel error:', error);
    }
}

function applyQueuedCandidates() {
    while (iceCandidatesQueue.length > 0) {
        const candidate = iceCandidatesQueue.shift();
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(error => console.error('Error adding queued ICE candidate:', error));
    }
}
}