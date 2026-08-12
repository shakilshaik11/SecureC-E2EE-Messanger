/**
 * SecureC Main Application Controller
 * Handles UI flows, Socket.IO WebSockets, E2EE key exchange orchestration, 
 * realtime messaging, media uploads, and voice recording.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Safe Socket.IO / Native WebSocket Wrapper with Message Queueing & Auto-Reconnect
  const socket = (function createSocketWrapper() {
    const listeners = {};
    const pendingEmits = [];
    let ws = null;

    function connect() {
      try {
        if (typeof io === 'function') {
          return io();
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        ws.onopen = async () => {
          console.log('✅ WebSocket Connection Established');
          while (pendingEmits.length > 0) {
            const item = pendingEmits.shift();
            try {
              ws.send(JSON.stringify(item));
            } catch (e) {
              console.error('Failed to flush queued websocket message:', e);
            }
          }
          if (currentRoomCode && currentUser && currentUser.uid) {
            console.log(`🔄 Auto-rejoining room ${currentRoomCode}...`);
            let pubKeyJwk = null;
            try {
              if (window.e2ee) pubKeyJwk = await window.e2ee.exportPublicKey();
            } catch (e) { }
            ws.send(JSON.stringify({
              action: 'rejoin-room',
              payload: {
                roomCode: currentRoomCode,
                userId: currentUser.uid,
                username: currentUser.username,
                avatar: currentUser.avatar,
                publicKey: pubKeyJwk
              }
            }));
          }
        };

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            const action = parsed.action;
            const payload = (parsed.payload !== undefined) ? parsed.payload : parsed;
            if (action && listeners[action]) {
              listeners[action].forEach(cb => cb(payload));
            }
          } catch (e) {
            console.error('WS Message Parse Error:', e);
          }
        };

        ws.onclose = () => {
          setTimeout(connect, 2000);
        };
      } catch (e) {
        console.warn('Native WebSocket init deferred:', e);
      }
    }

    connect();

    return {
      on(event, callback) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
      },
      emit(event, payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: event, payload }));
        } else {
          pendingEmits.push({ action: event, payload });
          if (!ws || ws.readyState === WebSocket.CLOSED) {
            connect();
          }
        }
      }
    };
  })();

  // Dark / Light Theme Toggle Switch Setup
  const savedTheme = localStorage.getItem('securec_theme') || 'light';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('securec_theme', theme);
    const isLight = (theme === 'light');

    document.querySelectorAll('.theme-switch-input').forEach(input => {
      input.checked = isLight;
    });
  }

  // Restore saved theme on startup
  applyTheme(savedTheme);

  // Bind change event listeners to all theme switch inputs across all headers
  document.querySelectorAll('.theme-switch-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const nextTheme = e.target.checked ? 'light' : 'dark';
      applyTheme(nextTheme);
      showToast(nextTheme === 'dark' ? '🌙 Dark Theme Activated' : '☀️ Light Theme Activated');
    });
  });

  // App Startup Splash Screen Manager
  const appLoadingScreen = document.getElementById('app-loading-screen');
  function hideLoadingScreen() {
    if (appLoadingScreen && !appLoadingScreen.classList.contains('fade-out')) {
      appLoadingScreen.classList.add('fade-out');
      setTimeout(() => {
        appLoadingScreen.style.display = 'none';
      }, 500);
    }
  }
  setTimeout(hideLoadingScreen, 5000);

  // App State Variables & Persisted User Identity
  let persistentUid = localStorage.getItem('securec_user_uid');
  if (!persistentUid) {
    persistentUid = 'user_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    localStorage.setItem('securec_user_uid', persistentUid);
  }
  let tabUid = sessionStorage.getItem('securec_tab_uid') || persistentUid;
  sessionStorage.setItem('securec_tab_uid', tabUid);

  let savedUsername = localStorage.getItem('securec_username') || 'User';
  let savedAvatar = localStorage.getItem('securec_avatar') || '🧑‍💻';

  let currentUser = {
    uid: tabUid,
    username: savedUsername,
    avatar: savedAvatar
  };

  function persistUserIdentity() {
    if (currentUser.uid) {
      sessionStorage.setItem('securec_tab_uid', currentUser.uid);
      localStorage.setItem('securec_user_uid', currentUser.uid);
    }
    if (currentUser.username) localStorage.setItem('securec_username', currentUser.username);
    if (currentUser.avatar) localStorage.setItem('securec_avatar', currentUser.avatar);
  }

  let currentRoomCode = null;
  let currentVaultPassphrase = null;
  let peerUser = null;
  let isE2EEActive = false;
  let selectedFile = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingTimerInterval = null;
  let recordingSeconds = 0;
  let typingTimeout = null;

  // Mobile background tab auto-reconnect handler
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentRoomCode && currentUser && currentUser.uid) {
      console.log('📱 Mobile tab refocused. Restoring session & key exchange state...');
      attemptSessionRejoin();
    }
  });

  async function attemptSessionRejoin() {
    if (!currentRoomCode || !currentUser || !currentUser.uid) return;
    let pubKeyJwk = null;
    try {
      if (window.e2ee) pubKeyJwk = await window.e2ee.exportPublicKey();
    } catch (e) { }
    socket.emit('rejoin-room', {
      roomCode: currentRoomCode,
      userId: currentUser.uid,
      username: currentUser.username,
      avatar: currentUser.avatar,
      publicKey: pubKeyJwk
    });
    shareLocalPublicKey();
  }

  // UI Element References
  const stepAuth = document.getElementById('step-auth');
  const tabSignin = document.getElementById('tab-signin');
  const tabSignup = document.getElementById('tab-signup');
  const authForm = document.getElementById('auth-form');
  const authEmail = document.getElementById('auth-email');
  const authPassword = document.getElementById('auth-password');
  const btnSubmitAuth = document.getElementById('btn-submit-auth');
  const authSubmitLabel = document.getElementById('auth-submit-label');
  const authAlert = document.getElementById('auth-alert');
  const authStatusBadge = document.getElementById('auth-status-badge');

  const stepProfile = document.getElementById('step-profile');
  const stepPortal = document.getElementById('step-portal');
  const stepChat = document.getElementById('step-chat');

  let authMode = 'signin'; // 'signin' or 'signup'
  let authenticatedUser = null;

  // Step 1 Elements
  const avatarOptions = document.querySelectorAll('.avatar-option');
  const usernameInput = document.getElementById('username-input');
  const btnSaveProfile = document.getElementById('btn-save-profile');

  // Step 2 Elements
  const portalUserAvatar = document.getElementById('portal-user-avatar');
  const portalUsername = document.getElementById('portal-username');
  const btnCreateRoom = document.getElementById('btn-create-room');
  const createdCodeBox = document.getElementById('created-code-box');
  const generatedRoomCode = document.getElementById('generated-room-code');
  const shareLinkInput = document.getElementById('share-link-input');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const joinCodeInput = document.getElementById('join-code-input');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const persistentKeyInput = document.getElementById('persistent-key-input');
  const btnOpenPersistentRoom = document.getElementById('btn-open-persistent-room');
  const btnJoinPersistentRoom = document.getElementById('btn-join-persistent-room');

  // Step 3 Elements (Chat)
  const chatPeerAvatar = document.getElementById('chat-peer-avatar');
  const peerStatusDot = document.getElementById('peer-status-dot');
  const chatPeerName = document.getElementById('chat-peer-name');
  const chatPeerStatus = document.getElementById('chat-peer-status');
  const chatRoomCodeText = document.getElementById('chat-room-code-text');
  const btnCopyChatCode = document.getElementById('btn-copy-chat-code');
  const btnVerifyKeys = document.getElementById('btn-verify-keys');
  const btnLeaveRoom = document.getElementById('btn-leave-room');
  const verifyModal = document.getElementById('verify-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const keyFingerprint = document.getElementById('key-fingerprint');
  const chatFeed = document.getElementById('chat-feed');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingUsername = document.getElementById('typing-username');

  // Pre-initialize E2EE Key Pair in background for zero-latency room creation & joining
  if (window.e2ee && typeof window.e2ee.generateKeyPair === 'function') {
    window.e2ee.generateKeyPair().catch(e => console.warn('Pre-KeyGen notice:', e));
  }

  // Input Controls
  const fileInput = document.getElementById('file-input');
  const btnAttach = document.getElementById('btn-attach');
  const attachmentPreview = document.getElementById('attachment-preview');
  const attachmentFilename = document.getElementById('attachment-filename');
  const attachmentSize = document.getElementById('attachment-size');
  const btnCancelAttachment = document.getElementById('btn-cancel-attachment');
  const btnRecordVoice = document.getElementById('btn-record-voice');
  const voiceRecordingBar = document.getElementById('voice-recording-bar');
  const voiceTimer = document.getElementById('voice-timer');
  const btnCancelVoice = document.getElementById('btn-cancel-voice');
  const btnSendVoice = document.getElementById('btn-send-voice');
  const messageInput = document.getElementById('message-input');
  const btnSendMessage = document.getElementById('btn-send-message');

  // =========================================================================
  // AUTHENTICATION LOGIC & EVENT HANDLERS
  // =========================================================================
  const authCardTitle = document.getElementById('auth-card-title');
  const authCardDesc = document.getElementById('auth-card-desc');

  function showAuthAlert(message, type = 'danger') {
    if (!authAlert) return;
    authAlert.className = `alert-box ${type}`;
    authAlert.innerHTML = `<i class="fa-solid ${type === 'danger' ? 'fa-circle-xmark' : 'fa-circle-check'}"></i> <div>${message}</div>`;
    authAlert.classList.remove('hidden');
    authAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearAuthAlert() {
    if (!authAlert) return;
    authAlert.classList.add('hidden');
  }

  // Toggle Tab (Sign In vs Sign Up)
  if (tabSignin && tabSignup) {
    tabSignin.addEventListener('click', () => {
      authMode = 'signin';
      tabSignin.classList.add('active');
      tabSignup.classList.remove('active');
      if (authCardTitle) authCardTitle.textContent = 'Sign In to SecureC';
      if (authCardDesc) authCardDesc.textContent = 'Access your zero-knowledge end-to-end encrypted messaging portal.';
      if (authSubmitLabel) authSubmitLabel.textContent = 'Sign In';
      clearAuthAlert();
    });

    tabSignup.addEventListener('click', () => {
      authMode = 'signup';
      tabSignup.classList.add('active');
      tabSignin.classList.remove('active');
      if (authCardTitle) authCardTitle.textContent = 'Create New Account';
      if (authCardDesc) authCardDesc.textContent = 'Enter your email & password to register your new account.';
      if (authSubmitLabel) authSubmitLabel.textContent = 'Create Account';
      clearAuthAlert();
    });
  }

  const btnGoogleAuth = document.getElementById('btn-google-auth');

  function formatAuthError(err) {
    if (!err) return 'Authentication failed. Please try again.';
    const code = err.code || '';
    switch (code) {
      case 'auth/email-not-verified':
        return '✉️ <strong>Email Address Not Verified Yet.</strong><br>We sent a verification link to your email address. Please open your inbox, click the link to verify your email, and then click Sign In.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return '<strong>Incorrect email or password.</strong> Please double-check your password, or click the <strong>Create Account</strong> tab if you haven\'t registered yet.';
      case 'auth/user-not-found':
        return '<strong>No account found with this email.</strong> Please click the <strong>Create Account</strong> tab above to sign up!';
      case 'auth/email-already-in-use':
        return '<strong>An account already exists with this email.</strong> Please click the <strong>Sign In</strong> tab to log in.';
      case 'auth/weak-password':
        return '<strong>Password is too weak.</strong> Password must be at least 6 characters long.';
      case 'auth/invalid-email':
        return '<strong>Invalid email address.</strong> Please enter a valid email address (e.g. name@example.com).';
      case 'auth/too-many-requests':
        return '<strong>Too many failed attempts.</strong> Access temporarily disabled. Please wait a moment and try again.';
      case 'auth/operation-not-allowed':
        return '<strong>Email/Password provider is disabled.</strong> Please enable Email/Password in your Firebase Console -> Authentication -> Sign-in method tab.';
      default:
        return err.message || (typeof err === 'string' ? err : 'Authentication failed. Please check your credentials.');
    }
  }

  // Handle Form Submit (Email / Password)
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlert();

      const email = authEmail ? authEmail.value.trim() : '';
      const password = authPassword ? authPassword.value : '';

      if (!email || !password) {
        showAuthAlert('Please enter both email and password.');
        return;
      }

      if (btnSubmitAuth) {
        btnSubmitAuth.disabled = true;
        btnSubmitAuth.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Authenticating...';
      }

      try {
        let result;
        if (authMode === 'signup') {
          result = await signUpWithEmail(email, password);

          // Switch tab to Sign In and inform user to verify email
          authMode = 'signin';
          if (tabSignin) tabSignin.classList.add('active');
          if (tabSignup) tabSignup.classList.remove('active');
          if (authCardTitle) authCardTitle.textContent = 'Sign In to SecureC';
          if (authCardDesc) authCardDesc.textContent = 'Access your zero-knowledge end-to-end encrypted messaging portal.';
          if (authSubmitLabel) authSubmitLabel.textContent = 'Sign In';

          showAuthAlert(`✉️ <strong>Verification Email Sent!</strong> A verification link has been sent to <strong>${escapeHtml(email)}</strong>.<br>Please open your email inbox, click the link to verify your email, and then click <strong>Sign In</strong>.`, 'info');
        } else {
          result = await signInWithEmail(email, password);
          handleSuccessfulAuth(result.user || result, result.isDemo);
        }
      } catch (err) {
        console.error('Auth Error:', err);
        showAuthAlert(formatAuthError(err));
      } finally {
        if (btnSubmitAuth) {
          btnSubmitAuth.disabled = false;
          btnSubmitAuth.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> <span>${authSubmitLabel ? authSubmitLabel.textContent : 'Continue'}</span>`;
        }
      }
    });
  }

  // Handle Google Auth Button Click
  if (btnGoogleAuth) {
    btnGoogleAuth.addEventListener('click', async () => {
      clearAuthAlert();
      btnGoogleAuth.disabled = true;
      btnGoogleAuth.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting to Google...';

      try {
        const result = await signInWithGoogle();
        handleSuccessfulAuth(result.user, result.isDemo);
      } catch (err) {
        console.error('Google Auth Error:', err);
        showAuthAlert(formatAuthError(err));
      } finally {
        btnGoogleAuth.disabled = false;
        btnGoogleAuth.innerHTML = '<i class="fa-brands fa-google"></i> <span>Continue with Google</span>';
      }
    });
  }



  // Handle Demo / Skip Login Button
  const btnDemoAuth = document.getElementById('btn-demo-auth');
  if (btnDemoAuth) {
    btnDemoAuth.addEventListener('click', () => {
      clearAuthAlert();
      const demoUser = {
        uid: 'demo_guest_' + Date.now(),
        email: 'guest@securec.local',
        displayName: 'User'
      };
      handleSuccessfulAuth(demoUser, true);
    });
  }

  // Proactively request microphone permission upon login/room entry
  async function requestMicrophonePermissionProactively() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        console.log("🎙️ Microphone permission granted proactively.");
      } catch (err) {
        console.warn("Proactive microphone permission check:", err);
      }
    }
  }

  // Handle Authentication Success
  function handleSuccessfulAuth(user, isDemo = false) {
    authenticatedUser = user;

    const name = user.displayName || user.phoneNumber || (user.email ? user.email.split('@')[0] : 'User');
    if (usernameInput) {
      usernameInput.value = name;
    }
    currentUser.username = name;

    const headerUserActions = document.getElementById('header-user-actions');
    const headerAvatar = document.getElementById('header-avatar');
    const headerUsername = document.getElementById('header-username');

    if (headerUserActions) headerUserActions.classList.remove('hidden');
    if (headerAvatar) headerAvatar.textContent = currentUser.avatar || '🧑‍💻';
    if (headerUsername) headerUsername.textContent = name;

    showAuthAlert('Authentication Successful!', 'success');

    // Prompt for microphone permission proactively on login
    requestMicrophonePermissionProactively();

    setTimeout(() => {
      if (stepAuth) stepAuth.classList.add('hidden');
      if (stepProfile) stepProfile.classList.remove('hidden');
    }, 600);
  }

  // Profile Modal & Header Logout Handlers
  const btnOpenProfile = document.getElementById('btn-open-profile');
  const btnHeaderLogout = document.getElementById('btn-header-logout');
  const profileModal = document.getElementById('profile-modal');
  const btnCloseProfileModal = document.getElementById('btn-close-profile-modal');
  const btnModalLogout = document.getElementById('btn-modal-logout');
  const btnSaveModalProfile = document.getElementById('btn-save-modal-profile');
  const profileNameInput = document.getElementById('profile-name-input');
  const profileEmailText = document.getElementById('profile-email-text');
  const profileUidText = document.getElementById('profile-uid-text');
  const profileFingerprintText = document.getElementById('profile-fingerprint-text');
  const profileModalAvatar = document.getElementById('profile-modal-avatar');
  const profileAvatarOptions = document.querySelectorAll('#profile-avatar-options .avatar-option');

  function updateProfileModalFields() {
    if (profileNameInput) profileNameInput.value = currentUser.username || '';
    if (profileModalAvatar) profileModalAvatar.textContent = currentUser.avatar || '🧑‍💻';
    if (profileUidText) profileUidText.textContent = (authenticatedUser && authenticatedUser.uid) ? authenticatedUser.uid : (currentUser.uid || 'user_' + Date.now().toString(36));
  }

  if (profileAvatarOptions) {
    profileAvatarOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        profileAvatarOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        currentUser.avatar = opt.dataset.avatar;
        if (profileModalAvatar) profileModalAvatar.textContent = currentUser.avatar;
        const headerAvatar = document.getElementById('header-avatar');
        if (headerAvatar) headerAvatar.textContent = currentUser.avatar;
      });
    });
  }

  if (btnOpenProfile) {
    btnOpenProfile.addEventListener('click', () => {
      updateProfileModalFields();
      if (profileModal) profileModal.classList.remove('hidden');
    });
  }

  if (btnCloseProfileModal) {
    btnCloseProfileModal.addEventListener('click', () => {
      if (profileModal) profileModal.classList.add('hidden');
    });
  }

  if (btnSaveModalProfile) {
    btnSaveModalProfile.addEventListener('click', () => {
      const newName = profileNameInput ? profileNameInput.value.trim() : '';
      if (newName) {
        currentUser.username = newName;
        const headerUsername = document.getElementById('header-username');
        if (headerUsername) headerUsername.textContent = newName;
        if (portalUsername) portalUsername.textContent = newName;
      }
      if (profileModal) profileModal.classList.add('hidden');
      showToast('Profile updated successfully!');
    });
  }

  async function performLogout() {
    try {
      if (typeof signOutUser === 'function') {
        await signOutUser();
      }
    } catch (e) { }
    authenticatedUser = null;
    const appWrapper = document.getElementById('app-root');
    if (appWrapper) appWrapper.classList.remove('in-chat');
    const headerUserActions = document.getElementById('header-user-actions');
    if (headerUserActions) headerUserActions.classList.add('hidden');
    if (profileModal) profileModal.classList.add('hidden');
    if (stepChat) stepChat.classList.add('hidden');
    if (stepPortal) stepPortal.classList.add('hidden');
    if (stepProfile) stepProfile.classList.add('hidden');
    if (stepAuth) stepAuth.classList.remove('hidden');
    showAuthAlert('Signed out successfully.', 'info');
  }

  if (btnHeaderLogout) btnHeaderLogout.addEventListener('click', performLogout);
  if (btnModalLogout) btnModalLogout.addEventListener('click', performLogout);

  // Check Firebase Auth state (store session without forcing auto-jump)
  if (typeof onAuthStateChangedListener === 'function') {
    onAuthStateChangedListener((user) => {
      if (user && user.emailVerified) {
        authenticatedUser = user;
      }
    });
  }

  // Check if URL has ?room=CODE
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  if (roomFromUrl) {
    joinCodeInput.value = roomFromUrl.toUpperCase();
  }

  // Handle Avatar Selection
  avatarOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      avatarOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      currentUser.avatar = opt.dataset.avatar;
    });
  });

  // Save Profile -> Go to Portal (Mandatory Name Check)
  const usernameErrorMsg = document.getElementById('username-error-msg');

  function validateAndSaveProfile() {
    const val = usernameInput ? usernameInput.value.trim() : '';
    if (!val) {
      if (usernameErrorMsg) {
        usernameErrorMsg.classList.remove('hidden');
      }
      if (usernameInput) {
        usernameInput.classList.add('input-error');
        usernameInput.focus();
      }
      return false;
    }

    if (usernameErrorMsg) {
      usernameErrorMsg.classList.add('hidden');
    }
    if (usernameInput) {
      usernameInput.classList.remove('input-error');
    }

    currentUser.username = val;
    localStorage.setItem('securec_username', val);

    if (portalUserAvatar) portalUserAvatar.textContent = currentUser.avatar;
    if (portalUsername) portalUsername.textContent = currentUser.username;

    const headerUsername = document.getElementById('header-username');
    if (headerUsername) headerUsername.textContent = currentUser.username;

    switchScreen(stepProfile, stepPortal);
    return true;
  }

  if (btnSaveProfile) {
    btnSaveProfile.addEventListener('click', validateAndSaveProfile);
  }

  if (usernameInput) {
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        validateAndSaveProfile();
      }
    });

    usernameInput.addEventListener('input', () => {
      if (usernameInput.value.trim()) {
        if (usernameErrorMsg) usernameErrorMsg.classList.add('hidden');
        usernameInput.classList.remove('input-error');
      }
    });
  }

  // =========================================================================
  // ROOM CREATION & JOINING FLOWS
  // =========================================================================

  // Server WebSocket Event: Room Created
  socket.on('room-created', async ({ success, roomCode, isPersistent, message }) => {
    btnCreateRoom.disabled = false;
    btnCreateRoom.innerHTML = '<i class="fa-solid fa-key"></i> <span>Create Room Code</span>';
    if (btnOpenPersistentRoom) {
      btnOpenPersistentRoom.disabled = false;
      btnOpenPersistentRoom.innerHTML = '<i class="fa-solid fa-folder-open"></i> <span>Open / Create Personal Room</span>';
    }

    if (success && roomCode) {
      currentRoomCode = roomCode;
      generatedRoomCode.textContent = currentRoomCode;

      const shareUrl = `${window.location.origin}/?room=${currentRoomCode}`;
      shareLinkInput.value = shareUrl;

      if (isPersistent) {
        await window.e2ee.deriveKeyFromPassphrase(roomCode);
        isE2EEActive = true;
        if (chatPeerStatus) {
          chatPeerStatus.textContent = '🔒 Persistent E2EE Room';
          chatPeerStatus.classList.add('text-success');
        }
        enterChatRoom();
        showToast(`Opened Personal Room: ${roomCode}`);
      } else {
        createdCodeBox.classList.remove('hidden');
        showToast('Ephemeral Room Created Successfully!');
      }
      shareLocalPublicKey();
    } else if (message) {
      alert(message);
    }
  });

  // Server WebSocket Event: Room Joined
  socket.on('room-joined', async ({ success, roomCode, isPersistent, members }) => {
    btnJoinRoom.disabled = false;
    btnJoinRoom.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> <span>Join Room</span>';
    if (btnJoinPersistentRoom) {
      btnJoinPersistentRoom.disabled = false;
      btnJoinPersistentRoom.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> <span>Join Personal Room</span>';
    }

    if (success && roomCode) {
      currentRoomCode = roomCode;
      if (isPersistent) {
        await window.e2ee.deriveKeyFromPassphrase(roomCode);
        isE2EEActive = true;
        if (chatPeerStatus) {
          chatPeerStatus.textContent = '🔒 Persistent E2EE Room';
          chatPeerStatus.classList.add('text-success');
        }
      }

      if (members && members.length > 0) {
        const currentId = currentUser.uid || currentUser.username;
        const peer = members.find(m => m.userId !== currentId);
        if (peer) {
          setupPeerInfo(peer);
          if (peer.publicKey && !isPersistent) {
            try {
              await window.e2ee.deriveSharedSecret(peer.publicKey);
              isE2EEActive = true;
              if (chatPeerStatus) {
                chatPeerStatus.textContent = '🔒 Encrypted & Connected';
                chatPeerStatus.classList.add('text-success');
              }
            } catch (e) {
              console.warn('E2EE key derivation from room member:', e);
            }
          }
        }
      }
      enterChatRoom();
      shareLocalPublicKey();
      showToast(`Joined Room ${roomCode}!`);
    }
  });

  // Client-Side Local History Cache Helpers
  function saveLocalMessageHistory(roomCode, item) {
    if (!roomCode || !item) return;
    try {
      const storageKey = 'securec_history_' + roomCode.toUpperCase();
      const existing = localStorage.getItem(storageKey);
      let list = existing ? JSON.parse(existing) : [];
      const itemId = item.id || (item.encryptedPayload && item.encryptedPayload.id);
      if (!list.some(m => (m.id === itemId || (m.encryptedPayload && m.encryptedPayload.id === itemId)))) {
        list.push(item);
        if (list.length > 300) list = list.slice(list.length - 300);
        localStorage.setItem(storageKey, JSON.stringify(list));
      }
    } catch (e) {
      console.warn('Local storage message save notice:', e);
    }
  }

  function getLocalMessageHistory(roomCode) {
    if (!roomCode) return [];
    try {
      const storageKey = 'securec_history_' + roomCode.toUpperCase();
      const existing = localStorage.getItem(storageKey);
      return existing ? JSON.parse(existing) : [];
    } catch (e) {
      return [];
    }
  }

  // Server WebSocket Event: Receive Saved Room History
  socket.on('room-history', async ({ roomCode, history }) => {
    const code = roomCode || currentRoomCode;
    let historyList = (history && Array.isArray(history) && history.length > 0) ? history : getLocalMessageHistory(code);

    if (!historyList || historyList.length === 0) return;

    // Derive room encryption key if not derived yet
    if (code && currentVaultPassphrase) {
      await window.e2ee.deriveKeyFromPassphrase(currentVaultPassphrase);
    } else if (code) {
      await window.e2ee.deriveKeyFromPassphrase(code);
    }

    showToast('📜 Restoring E2EE chat history...');

    // Clear previous feed content (welcome pills/placeholders)
    if (chatFeed) {
      chatFeed.innerHTML = `
        <div class="system-message">
          <div class="system-pill">
            <i class="fa-solid fa-lock text-emerald"></i>
            <span>Persistent E2EE Session — Decrypted Chat History Restored</span>
          </div>
        </div>
      `;
    }

    for (const item of historyList) {
      try {
        saveLocalMessageHistory(code, item);

        const encryptedPayload = item.encryptedPayload || item;
        const payloadObj = encryptedPayload.payload || encryptedPayload;

        const decryptedData = await window.e2ee.decrypt(payloadObj);
        let content = decryptedData;
        let mediaType = encryptedPayload.mediaType || 'text';
        let meta = encryptedPayload.meta || {};

        if (encryptedPayload.isBinary) {
          const base64Data = window.e2ee.arrayBufferToBase64(decryptedData);
          const mime = meta.mimeType || (mediaType === 'image' ? 'image/png' : (mediaType === 'voice' ? 'audio/webm' : 'application/octet-stream'));
          content = `data:${mime};base64,${base64Data}`;
        }

        const itemSenderId = item.senderUserId || (encryptedPayload && encryptedPayload.senderUserId);
        const itemSenderName = item.senderUsername || (encryptedPayload && encryptedPayload.senderUsername);
        const storedUid = localStorage.getItem('securec_user_uid');
        const storedName = localStorage.getItem('securec_username');

        let isOwn = false;
        if (itemSenderId && (itemSenderId === currentUser.uid || itemSenderId === storedUid)) {
          isOwn = true;
        } else if (itemSenderName) {
          const sName = String(itemSenderName).toLowerCase();
          if ((currentUser.username && sName === currentUser.username.toLowerCase()) || (storedName && sName === storedName.toLowerCase())) {
            isOwn = true;
          }
        }

        const senderName = isOwn ? (currentUser.username || storedName || 'Me') : (itemSenderName || (peerUser ? peerUser.username : 'Participant'));

        appendMessageToFeed({
          id: encryptedPayload.id || item.id || ('msg_' + Date.now()),
          sender: senderName,
          isOwn: isOwn,
          content: content,
          mediaType: mediaType,
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          replyTo: encryptedPayload.replyTo || null,
          createdTime: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
          timestamp: new Date(item.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      } catch (err) {
        console.warn('History decryption notice:', err);
      }
    }
  });

  // Server WebSocket Event: Join Failed
  socket.on('join-failed', ({ message }) => {
    btnJoinRoom.disabled = false;
    btnJoinRoom.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> <span>Join Room</span>';
    alert(message || 'Failed to join room. Please check the code.');
  });

  // Create Room Click Handler (Instant Room Code Generation)
  // Create Room Click Handler
  btnCreateRoom.addEventListener('click', () => {
    btnCreateRoom.disabled = true;
    btnCreateRoom.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

    // Background key pair generation (non-blocking)
    if (!window.e2ee.keyPair) {
      window.e2ee.generateKeyPair().catch(err => console.error('E2EE KeyGen:', err));
    }

    const userId = currentUser.uid || 'user_' + Math.random().toString(36).substring(2, 9);
    currentUser.uid = userId;

    socket.emit('create-room', {
      userId: userId,
      username: currentUser.username,
      avatar: currentUser.avatar
    });

    // Reset button UI if network drops out after 10 seconds
    setTimeout(() => {
      if (btnCreateRoom.disabled && !currentRoomCode) {
        btnCreateRoom.disabled = false;
        btnCreateRoom.innerHTML = '<i class="fa-solid fa-key"></i> <span>Create Room Code</span>';
      }
    }, 10000);
  });

  // Copy Room Code & Link handlers
  btnCopyCode.addEventListener('click', () => {
    if (!currentRoomCode) return;
    navigator.clipboard.writeText(currentRoomCode);
    showToast('Room Code Copied!');
  });

  btnCopyLink.addEventListener('click', () => {
    if (!shareLinkInput.value) return;
    navigator.clipboard.writeText(shareLinkInput.value);
    showToast('Shareable Link Copied!');
  });

  btnCopyChatCode.addEventListener('click', () => {
    if (!currentRoomCode) return;
    navigator.clipboard.writeText(currentRoomCode);
    showToast('Room Code Copied!');
  });

  // Join Room Click Handler (Instant Join)
  btnJoinRoom.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
      alert('Please enter a valid 6-character room code');
      return;
    }

    btnJoinRoom.disabled = true;
    btnJoinRoom.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Joining...';

    // Background key pair generation (non-blocking)
    if (!window.e2ee.keyPair) {
      window.e2ee.generateKeyPair().catch(err => console.error('E2EE KeyGen:', err));
    }

    const userId = currentUser.uid || 'user_' + Math.random().toString(36).substring(2, 9);
    currentUser.uid = userId;

    socket.emit('join-room', {
      roomCode: code,
      userId: userId,
      username: currentUser.username,
      avatar: currentUser.avatar
    });
  });

  // Auto uppercase code input
  joinCodeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // Open / Create Persistent Personal Room Click Handler
  if (btnOpenPersistentRoom) {
    btnOpenPersistentRoom.addEventListener('click', () => {
      const customCode = persistentKeyInput ? persistentKeyInput.value.trim() : '';
      if (!customCode || customCode.length < 3) {
        alert('Please enter a custom room key or passcode (at least 3 characters)');
        return;
      }

      btnOpenPersistentRoom.disabled = true;
      btnOpenPersistentRoom.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening...';

      if (!window.e2ee.keyPair) {
        window.e2ee.generateKeyPair().catch(err => console.error('E2EE KeyGen:', err));
      }

      const userId = currentUser.uid || 'user_' + Math.random().toString(36).substring(2, 9);
      currentUser.uid = userId;

      socket.emit('create-room', {
        userId,
        username: currentUser.username,
        avatar: currentUser.avatar,
        isPersistent: true,
        customCode: customCode
      });
    });
  }

  // Join Persistent Personal Room Click Handler
  if (btnJoinPersistentRoom) {
    btnJoinPersistentRoom.addEventListener('click', () => {
      const customCode = persistentKeyInput ? persistentKeyInput.value.trim() : '';
      if (!customCode || customCode.length < 3) {
        alert('Please enter a custom room key or passcode (at least 3 characters)');
        return;
      }

      btnJoinPersistentRoom.disabled = true;
      btnJoinPersistentRoom.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Joining...';

      if (!window.e2ee.keyPair) {
        window.e2ee.generateKeyPair().catch(err => console.error('E2EE KeyGen:', err));
      }

      const userId = currentUser.uid || 'user_' + Math.random().toString(36).substring(2, 9);
      currentUser.uid = userId;

      socket.emit('join-room', {
        roomCode: customCode,
        userId,
        username: currentUser.username,
        avatar: currentUser.avatar,
        isPersistent: true
      });
    });
  }

  // MyData Cloud Vault Elements & Click Handlers
  const btnHomeMyData = document.getElementById('btn-home-mydata');
  const mydataVaultIdInput = document.getElementById('mydata-vault-id-input');
  const mydataPasscodeInput = document.getElementById('mydata-passcode-input');
  const btnOpenMydata = document.getElementById('btn-open-mydata');
  const navBtnMydata = document.getElementById('nav-btn-mydata');

  if (btnHomeMyData) {
    btnHomeMyData.addEventListener('click', () => {
      showScreen(stepPortal);
      if (mydataVaultIdInput) mydataVaultIdInput.focus();
    });
  }

  if (navBtnMydata) {
    navBtnMydata.addEventListener('click', () => {
      showScreen(stepPortal);
      if (mydataVaultIdInput) mydataVaultIdInput.focus();
    });
  }

  if (btnOpenMydata) {
    btnOpenMydata.addEventListener('click', async () => {
      const vaultId = mydataVaultIdInput ? mydataVaultIdInput.value.trim() : '';
      const masterPasscode = mydataPasscodeInput ? mydataPasscodeInput.value.trim() : '';

      if (!vaultId || vaultId.length < 3) {
        alert('Please enter a Unique Vault ID (at least 3 characters, e.g. shakil_vault_2026)');
        if (mydataVaultIdInput) mydataVaultIdInput.focus();
        return;
      }

      if (!masterPasscode || masterPasscode.length < 3) {
        alert('Please enter your Secret Master Password (at least 3 characters)');
        if (mydataPasscodeInput) mydataPasscodeInput.focus();
        return;
      }

      const formattedVaultCode = 'MYDATA_' + vaultId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const combinedPassphrase = formattedVaultCode + '_' + masterPasscode;

      btnOpenMydata.disabled = true;
      btnOpenMydata.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Unlocking Vault...';

      // Store vault passphrase for history decryption
      currentVaultPassphrase = combinedPassphrase;

      // Derive AES-256 Key from Vault ID + Secret Master Password
      await window.e2ee.deriveKeyFromPassphrase(combinedPassphrase);

      currentRoomCode = formattedVaultCode;
      isE2EEActive = true;

      const userId = currentUser.uid || 'user_' + Math.random().toString(36).substring(2, 9);
      currentUser.uid = userId;

      socket.emit('join-room', {
        roomCode: formattedVaultCode,
        userId,
        username: currentUser.username,
        avatar: currentUser.avatar,
        isPersistent: true
      });
    });
  }

  // =========================================================================
  // KEY EXCHANGE & SOCKET EVENT LISTENERS
  // =========================================================================

  async function shareLocalPublicKey() {
    if (!currentRoomCode) return;
    if (!window.e2ee.keyPair) {
      await window.e2ee.generateKeyPair();
    }
    const pubKeyJwk = await window.e2ee.exportPublicKey();
    socket.emit('share-public-key', {
      roomCode: currentRoomCode,
      userId: currentUser.uid,
      publicKey: pubKeyJwk
    });
  }

  // Socket Event: Peer Joined Room
  socket.on('user-joined', async ({ user }) => {
    setupPeerInfo(user);
    if (peerStatusDot) peerStatusDot.className = 'status-dot online';
    if (chatPeerStatus) {
      chatPeerStatus.textContent = '🔒 Encrypted & Connected';
      chatPeerStatus.classList.add('text-success');
    }
    showSystemNotification(`${user.username} joined the room.`);

    // Automatically transition host from portal to chat view
    if (!stepPortal.classList.contains('hidden')) {
      enterChatRoom();
    }

    if (user.publicKey) {
      try {
        await window.e2ee.deriveSharedSecret(user.publicKey);
        isE2EEActive = true;
      } catch (e) { }
    }

    // Re-share public key so newly joined user gets host key
    await shareLocalPublicKey();
  });

  // Socket Event: Peer Rejoined Room
  socket.on('user-rejoined', async ({ user }) => {
    setupPeerInfo(user);
    if (peerStatusDot) peerStatusDot.className = 'status-dot online';
    if (chatPeerStatus) {
      chatPeerStatus.textContent = '🔒 Encrypted & Connected';
      chatPeerStatus.classList.add('text-success');
    }
    showSystemNotification(`${user.username || 'Peer'} reconnected.`);

    if (user.publicKey) {
      try {
        await window.e2ee.deriveSharedSecret(user.publicKey);
        isE2EEActive = true;
      } catch (e) { }
    }
    await shareLocalPublicKey();
  });

  // Socket Event: Peer Online / Offline Status Change (Grace Period Support)
  socket.on('user-status-changed', ({ userId, isOnline, isTemporary }) => {
    if (peerUser && (peerUser.userId === userId || peerUser.uid === userId)) {
      if (isOnline) {
        if (peerStatusDot) peerStatusDot.className = 'status-dot online';
        if (chatPeerStatus) {
          chatPeerStatus.textContent = '🔒 Encrypted & Connected';
          chatPeerStatus.classList.add('text-success');
        }
      } else {
        if (peerStatusDot) peerStatusDot.className = 'status-dot offline';
        if (chatPeerStatus) {
          chatPeerStatus.textContent = isTemporary ? 'Reconnecting...' : 'Participant disconnected';
          chatPeerStatus.classList.remove('text-success');
        }
      }
    }
  });

  let hasNotifiedKeyExchange = false;

  // Socket Event: Peer Public Key Received -> Complete ECDH Derivation
  socket.on('peer-public-key', async (data) => {
    const publicKey = data ? (data.publicKey || data) : null;
    if (!publicKey) return;

    try {
      await window.e2ee.deriveSharedSecret(publicKey);
      isE2EEActive = true;

      // Update Security Status in Header
      if (chatPeerStatus) {
        chatPeerStatus.textContent = '🔒 End-to-End Encrypted';
        chatPeerStatus.classList.add('text-success');
      }

      // Generate fingerprint representation
      try {
        const jwkStr = JSON.stringify(publicKey);
        if (keyFingerprint) keyFingerprint.textContent = await computeFingerprint(jwkStr);
      } catch (e) { }

      const name = peerUser ? peerUser.username : 'Peer';
      if (!hasNotifiedKeyExchange) {
        hasNotifiedKeyExchange = true;
        showSystemNotification(`🔒 E2EE Key Exchange with ${name} successful!`);
      }
    } catch (err) {
      console.error('Failed to complete E2EE Key Exchange:', err);
    }
  });

  // Socket Event: Peer Left Room
  socket.on('user-left', ({ username }) => {
    peerStatusDot.className = 'status-dot offline';
    chatPeerStatus.textContent = 'Participant disconnected';
    chatPeerStatus.classList.remove('text-success');
    isE2EEActive = false;
    showSystemNotification(`${username || 'Participant'} left the room.`);
  });

  // Socket Event: Peer Typing
  socket.on('peer-typing', ({ senderUsername, isTyping }) => {
    if (isTyping) {
      typingUsername.textContent = senderUsername || 'Participant';
      typingIndicator.classList.remove('hidden');
    } else {
      typingIndicator.classList.add('hidden');
    }
  });

  // Socket Event: Peer Message Delivered Ack
  socket.on('peer-message-ack', ({ messageId }) => {
    const msgEl = document.getElementById(`msg-${messageId}`);
    if (msgEl) {
      const ticks = msgEl.querySelector('.read-tick');
      if (ticks) {
        ticks.innerHTML = '<i class="fa-solid fa-check-double text-primary"></i>';
      }
    }
  });

  // Socket Event: Receive Encrypted Message Payload
  socket.on('receive-encrypted-message', async (data) => {
    try {
      const encryptedPayload = data.encryptedPayload || data;
      const payloadObj = encryptedPayload.payload || encryptedPayload;
      const senderName = peerUser ? peerUser.username : 'Peer';

      // Decrypt client-side using shared key
      const decryptedData = await window.e2ee.decrypt(payloadObj);

      let content = decryptedData;
      let mediaType = encryptedPayload.mediaType || 'text';
      let meta = encryptedPayload.meta || {};

      if (encryptedPayload.isBinary) {
        const base64Data = window.e2ee.arrayBufferToBase64(decryptedData);
        const mime = meta.mimeType || (mediaType === 'image' ? 'image/png' : (mediaType === 'voice' ? 'audio/webm' : 'application/octet-stream'));
        content = `data:${mime};base64,${base64Data}`;
      }

      saveLocalMessageHistory(currentRoomCode, {
        id: encryptedPayload.id || ('msg_' + Date.now()),
        senderUserId: data.senderUserId,
        senderUsername: senderName,
        encryptedPayload: encryptedPayload,
        timestamp: data.timestamp || new Date().toISOString()
      });

      appendMessageToFeed({
        id: encryptedPayload.id || ('msg_' + Date.now()),
        sender: senderName,
        isOwn: false,
        content: content,
        mediaType: mediaType,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        replyTo: encryptedPayload.replyTo || null,
        createdTime: Date.now(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

    } catch (err) {
      console.error('Decryption failed for received payload:', err);
      showSystemNotification('⚠️ Failed to decrypt incoming payload (Key mismatch)');
    }
  });

  // Socket Event: Receive Edited Message
  socket.on('receive-edited-message', async (data) => {
    try {
      const { messageId, encryptedPayload } = data;
      const payloadObj = encryptedPayload.payload || encryptedPayload;
      const decryptedText = await window.e2ee.decrypt(payloadObj);

      const msgData = messageStore.get(messageId);
      if (msgData) {
        msgData.content = decryptedText;
        msgData.isEdited = true;
      }

      const textEl = document.getElementById(`msg-text-${messageId}`);
      if (textEl) {
        textEl.innerHTML = `${escapeHtml(decryptedText)} <span class="edited-tag">(edited)</span>`;
      }
      showToast('✏️ Message edited by peer');
    } catch (e) {
      console.error('Failed to decrypt edited message:', e);
    }
  });

  // Socket Event: Receive Message Reaction
  socket.on('receive-message-reaction', ({ senderUsername, senderUserId, messageId, emoji }) => {
    const user = senderUsername || senderUserId || 'Peer';
    updateMessageReaction(messageId, emoji, user);
  });

  // Socket Event: Receive Pinned Message
  socket.on('receive-pinned-message', ({ messageId, text, isPinned }) => {
    if (isPinned) {
      if (pinnedMessageBar) pinnedMessageBar.classList.remove('hidden');
      if (pinnedMessageText) pinnedMessageText.textContent = text || 'Pinned Message';
      showToast('📌 Message pinned by peer');
    } else {
      if (pinnedMessageBar) pinnedMessageBar.classList.add('hidden');
    }
  });

  // =========================================================================
  // MESSAGE SENDING & MEDIA ATTACHMENTS
  // =========================================================================

  btnSendMessage.addEventListener('click', handleSendMessage);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Typing event emitter
  messageInput.addEventListener('input', () => {
    if (!currentRoomCode) return;
    socket.emit('typing', { roomCode: currentRoomCode, isTyping: true });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('typing', { roomCode: currentRoomCode, isTyping: false });
    }, 1500);
  });

  // Helper to guarantee active E2EE key without blocking user
  async function ensureE2EEActive() {
    if (isE2EEActive && window.e2ee && window.e2ee.sharedAESKey) {
      return true;
    }
    try {
      if (!window.e2ee.keyPair) {
        await window.e2ee.generateKeyPair();
      }
      if (!window.e2ee.sharedAESKey) {
        await window.e2ee.deriveSharedSecret();
        await shareLocalPublicKey();
      }
      isE2EEActive = true;
      if (chatPeerStatus) {
        chatPeerStatus.textContent = '🔒 Encrypted & Connected';
        chatPeerStatus.classList.add('text-success');
      }
      return true;
    } catch (e) {
      console.warn('E2EE auto-initialization check:', e);
      return true;
    }
  }

  // Enter Chat Room View & Initialize E2EE
  async function enterChatRoom() {
    if (chatRoomCodeText) chatRoomCodeText.textContent = currentRoomCode || '------';

    // Switch screens to Chat UI
    if (stepPortal) stepPortal.classList.add('hidden');
    if (stepProfile) stepProfile.classList.add('hidden');
    if (stepAuth) stepAuth.classList.add('hidden');
    if (stepChat) stepChat.classList.remove('hidden');

    await ensureE2EEActive();

    // Proactively request microphone permission upon entering chat
    requestMicrophonePermissionProactively();

    showSystemNotification(`Joined room ${currentRoomCode || ''}. All messages are private & encrypted.`);
  }

  // Global State for Rich Messaging Features
  const messageStore = new Map();
  let activeReplyMessage = null;
  let activeEditMessage = null;

  const replyPreviewBar = document.getElementById('reply-preview-bar');
  const replySenderName = document.getElementById('reply-sender-name');
  const replySnippetText = document.getElementById('reply-snippet-text');
  const btnCancelReply = document.getElementById('btn-cancel-reply');

  const editPreviewBar = document.getElementById('edit-preview-bar');
  const editSnippetText = document.getElementById('edit-snippet-text');
  const btnCancelEdit = document.getElementById('btn-cancel-edit');

  const pinnedMessageBar = document.getElementById('pinned-message-bar');
  const pinnedMessageText = document.getElementById('pinned-message-text');
  const btnUnpinMessage = document.getElementById('btn-unpin-message');

  const btnToggleSearch = document.getElementById('btn-toggle-search');
  const searchBarContainer = document.getElementById('search-bar-container');
  const chatSearchInput = document.getElementById('chat-search-input');
  const btnCloseSearch = document.getElementById('btn-close-search');

  if (btnCancelReply) {
    btnCancelReply.addEventListener('click', () => {
      activeReplyMessage = null;
      if (replyPreviewBar) replyPreviewBar.classList.add('hidden');
    });
  }

  if (btnCancelEdit) {
    btnCancelEdit.addEventListener('click', () => {
      activeEditMessage = null;
      if (editPreviewBar) editPreviewBar.classList.add('hidden');
      messageInput.value = '';
    });
  }

  if (btnUnpinMessage) {
    btnUnpinMessage.addEventListener('click', () => {
      if (pinnedMessageBar) pinnedMessageBar.classList.add('hidden');
      socket.emit('pin-message', { roomCode: currentRoomCode, messageId: null, isPinned: false });
    });
  }

  if (btnToggleSearch) {
    btnToggleSearch.addEventListener('click', () => {
      if (!searchBarContainer) return;
      searchBarContainer.classList.toggle('hidden');
      if (!searchBarContainer.classList.contains('hidden') && chatSearchInput) {
        chatSearchInput.focus();
      } else {
        clearSearchHighlights();
      }
    });
  }

  if (btnCloseSearch) {
    btnCloseSearch.addEventListener('click', () => {
      if (searchBarContainer) searchBarContainer.classList.add('hidden');
      if (chatSearchInput) chatSearchInput.value = '';
      clearSearchHighlights();
    });
  }

  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      performSearchHighlight(query);
    });
  }

  function performSearchHighlight(query) {
    messageStore.forEach((msg, id) => {
      const row = document.getElementById(`msg-${id}`);
      if (!row) return;

      const textEl = document.getElementById(`msg-text-${id}`);
      if (!textEl) return;

      if (!query) {
        textEl.innerHTML = escapeHtml(msg.content) + (msg.isEdited ? ' <span class="edited-tag">(edited)</span>' : '');
        row.style.opacity = '1';
        return;
      }

      const text = (msg.content || '').toLowerCase();
      if (text.includes(query)) {
        row.style.opacity = '1';
        const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
        const highlighted = escapeHtml(msg.content).replace(regex, '<mark class="search-highlight">$1</mark>');
        textEl.innerHTML = highlighted + (msg.isEdited ? ' <span class="edited-tag">(edited)</span>' : '');
      } else {
        row.style.opacity = '0.35';
      }
    });
  }

  function clearSearchHighlights() {
    messageStore.forEach((msg, id) => {
      const row = document.getElementById(`msg-${id}`);
      if (row) row.style.opacity = '1';
      const textEl = document.getElementById(`msg-text-${id}`);
      if (textEl && msg.mediaType === 'text') {
        textEl.innerHTML = escapeHtml(msg.content) + (msg.isEdited ? ' <span class="edited-tag">(edited)</span>' : '');
      }
    });
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Global Action Handlers for Message Bubbles
  window.triggerReplyMessage = function (id) {
    const msg = messageStore.get(id);
    if (!msg) return;
    const textSnippet = msg.mediaType === 'text' ? msg.content : `[${msg.mediaType}]`;
    activeReplyMessage = { id: msg.id, sender: msg.sender, text: textSnippet };
    if (replySenderName) replySenderName.textContent = `Replying to ${msg.sender}`;
    if (replySnippetText) replySnippetText.textContent = textSnippet;
    if (replyPreviewBar) replyPreviewBar.classList.remove('hidden');
    if (messageInput) messageInput.focus();
  };

  window.triggerEditMessage = function (id) {
    const msg = messageStore.get(id);
    if (!msg || !msg.isOwn || msg.mediaType !== 'text') return;

    const ageMins = (Date.now() - msg.createdTime) / (1000 * 60);
    if (ageMins > 15) {
      alert('⚠️ Messages can only be edited within 15 minutes of sending.');
      return;
    }

    activeEditMessage = { id: msg.id, text: msg.content };
    if (editSnippetText) editSnippetText.textContent = msg.content;
    if (editPreviewBar) editPreviewBar.classList.remove('hidden');
    if (messageInput) {
      messageInput.value = msg.content;
      messageInput.focus();
    }
  };

  window.triggerStarMessage = function (id) {
    const msg = messageStore.get(id);
    if (!msg) return;
    msg.isStarred = !msg.isStarred;
    const badgeEl = document.getElementById(`star-badge-${id}`);
    if (badgeEl) {
      badgeEl.innerHTML = msg.isStarred ? '<i class="fa-solid fa-star star-icon-badge" title="Starred"></i>' : '';
    }
    showToast(msg.isStarred ? '⭐ Message Starred' : 'Unstarred Message');
  };

  window.triggerPinMessage = function (id) {
    const msg = messageStore.get(id);
    if (!msg) return;
    const textSnippet = msg.mediaType === 'text' ? msg.content : `[${msg.mediaType}]`;
    if (pinnedMessageBar) pinnedMessageBar.classList.remove('hidden');
    if (pinnedMessageText) pinnedMessageText.textContent = `${msg.sender}: ${textSnippet}`;
    socket.emit('pin-message', {
      roomCode: currentRoomCode,
      messageId: id,
      text: `${msg.sender}: ${textSnippet}`,
      isPinned: true
    });
    showToast('📌 Message Pinned to Room Header');
  };

  // =========================================================================
  // CUSTOM REACTION EMOJIS & PICKER MODAL
  // =========================================================================
  const DEFAULT_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  let activeReactionModalMessageId = null;

  function getQuickReactionEmojis() {
    try {
      const saved = localStorage.getItem('securec_custom_reaction_emojis');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Error reading custom reaction emojis:', e);
    }
    return [...DEFAULT_REACTION_EMOJIS];
  }

  function saveQuickReactionEmojis(emojis) {
    try {
      localStorage.setItem('securec_custom_reaction_emojis', JSON.stringify(emojis));
    } catch (e) {
      console.error('Error saving custom reaction emojis:', e);
    }
  }

  window.addCustomReactionEmoji = function (emoji) {
    if (!emoji || typeof emoji !== 'string') return;
    const cleanEmoji = emoji.trim();
    if (!cleanEmoji) return;

    let list = getQuickReactionEmojis();
    if (!list.includes(cleanEmoji)) {
      list.push(cleanEmoji);
      saveQuickReactionEmojis(list);
      updateAllReactionToolbarsUI();
    }
  };

  window.removeCustomReactionEmoji = function (emoji) {
    let list = getQuickReactionEmojis();
    list = list.filter(e => e !== emoji);

    if (list.length === 0 || list.every(e => DEFAULT_REACTION_EMOJIS.includes(e))) {
      localStorage.removeItem('securec_custom_reaction_emojis');
    } else {
      saveQuickReactionEmojis(list);
    }

    renderEmojiPickerModalContent();
    updateAllReactionToolbarsUI();
  };

  function resetQuickReactionEmojis() {
    localStorage.removeItem('securec_custom_reaction_emojis');
    renderEmojiPickerModalContent();
    updateAllReactionToolbarsUI();
    showToast('✨ Quick reactions reset to default 6 emojis');
  }

  function buildReactionsToolbarHtml(messageId) {
    const emojis = getQuickReactionEmojis();
    const emojiBtnsHtml = emojis.map(e => `
      <button class="reaction-emoji-btn" title="React ${e}" onclick="triggerReaction('${messageId}', '${e}')">${e}</button>
    `).join('');

    return `
      <div class="reactions-toolbar" id="reactions-toolbar-${messageId}">
        ${emojiBtnsHtml}
        <button class="reaction-add-btn" title="More Emojis (+)" onclick="openEmojiPickerModal('${messageId}', event)">
          <i class="fa-solid fa-plus"></i>
        </button>
        <button class="reaction-action-icon" title="Reply" onclick="triggerReplyMessage('${messageId}')">
          <i class="fa-solid fa-reply"></i>
        </button>
      </div>
    `;
  }

  function updateAllReactionToolbarsUI() {
    messageStore.forEach((msg, id) => {
      const tb = document.getElementById(`reactions-toolbar-${id}`);
      if (tb) {
        const parent = tb.parentElement;
        if (parent) {
          const tempContainer = document.createElement('div');
          tempContainer.innerHTML = buildReactionsToolbarHtml(id);
          const newTb = tempContainer.firstElementChild;
          if (tb.classList.contains('active')) newTb.classList.add('active');
          if (tb.classList.contains('closed')) newTb.classList.add('closed');
          parent.replaceChild(newTb, tb);
        }
      }
    });
  }

  const emojiCategories = {
    reactions: ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '✨', '🎉', '💯', '🚀', '🥳', '🤩', '😎'],
    smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '🥹', '😉', '😊', '🥰', '😍', '😘', '😋', '😜', '🤪', '😝', '🤑', '🤗', '🫣', '🤫', '🤔', '🫡', '🙄', '😬', '😔', '😴', '😷', '🤒', '🤢', '🤮', '🤯', '🤠', '💩', '💀', '👽', '🤖'],
    gestures: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '✍️', '💅', '🤳', '💪'],
    symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '⭐', '🌟', '✨', '💥', '💯', '🎯', '🎨', '🔥', '💧', '⚡', '🏆', '🎁', '🎂', '🍕', '🥂']
  };

  const emojiPickerModal = document.getElementById('emoji-picker-modal');
  const btnCloseEmojiModal = document.getElementById('btn-close-emoji-modal');
  const btnResetQuickEmojis = document.getElementById('btn-reset-quick-emojis');
  const customEmojiInput = document.getElementById('custom-emoji-input');
  const btnSubmitCustomEmoji = document.getElementById('btn-submit-custom-emoji');

  window.openEmojiPickerModal = function (messageId, event) {
    if (event) event.stopPropagation();
    activeReactionModalMessageId = messageId;
    renderEmojiPickerModalContent();
    if (customEmojiInput) customEmojiInput.value = '';
    if (emojiPickerModal) emojiPickerModal.classList.remove('hidden');

    // Hide any open reactions toolbar
    const tb = document.getElementById(`reactions-toolbar-${messageId}`);
    if (tb) {
      tb.classList.remove('active');
      tb.classList.add('closed');
    }
  };

  function closeEmojiPickerModal() {
    if (emojiPickerModal) emojiPickerModal.classList.add('hidden');
    activeReactionModalMessageId = null;
  }

  function renderEmojiPickerModalContent() {
    const quickListContainer = document.getElementById('quick-emojis-list');
    if (quickListContainer) {
      const currentEmojis = getQuickReactionEmojis();
      const isCustomized = localStorage.getItem('securec_custom_reaction_emojis') !== null;

      quickListContainer.innerHTML = currentEmojis.map(emoji => {
        const isDefault = DEFAULT_REACTION_EMOJIS.includes(emoji);
        const showRemove = isCustomized || !isDefault;
        return `
          <div class="quick-emoji-chip">
            <span>${emoji}</span>
            ${showRemove ? `<button class="btn-remove-emoji" title="Remove emoji" onclick="removeCustomReactionEmoji('${emoji}')"><i class="fa-solid fa-xmark"></i></button>` : ''}
          </div>
        `;
      }).join('');
    }

    for (const [catKey, emojiList] of Object.entries(emojiCategories)) {
      const gridContainer = document.getElementById(`emoji-grid-${catKey}`);
      if (gridContainer) {
        gridContainer.innerHTML = emojiList.map(e => `
          <button class="emoji-grid-item" onclick="selectModalEmoji('${e}')">${e}</button>
        `).join('');
      }
    }
  }

  window.selectModalEmoji = function (emoji) {
    if (!activeReactionModalMessageId) return;
    addCustomReactionEmoji(emoji);
    triggerReaction(activeReactionModalMessageId, emoji);
    closeEmojiPickerModal();
  };

  if (btnCloseEmojiModal) {
    btnCloseEmojiModal.addEventListener('click', closeEmojiPickerModal);
  }

  if (btnResetQuickEmojis) {
    btnResetQuickEmojis.addEventListener('click', () => {
      resetQuickReactionEmojis();
    });
  }

  function handleCustomEmojiSubmit() {
    if (!customEmojiInput || !activeReactionModalMessageId) return;
    const val = customEmojiInput.value.trim();
    if (!val) return;

    addCustomReactionEmoji(val);
    triggerReaction(activeReactionModalMessageId, val);
    closeEmojiPickerModal();
  }

  if (btnSubmitCustomEmoji) {
    btnSubmitCustomEmoji.addEventListener('click', handleCustomEmojiSubmit);
  }

  if (customEmojiInput) {
    customEmojiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCustomEmojiSubmit();
      }
    });
  }

  window.toggleReactionToolbar = function (id, event) {
    if (event) event.stopPropagation();
    const toolbar = document.getElementById(`reactions-toolbar-${id}`);
    if (!toolbar) return;

    document.querySelectorAll('.reactions-toolbar.active').forEach(tb => {
      if (tb !== toolbar) {
        tb.classList.remove('active');
        tb.classList.add('closed');
      }
    });

    toolbar.classList.remove('closed');
    toolbar.classList.toggle('active');
  };

  window.triggerReaction = function (id, emoji) {
    const username = (currentUser && currentUser.username) ? currentUser.username : 'User';
    socket.emit('message-reaction', {
      roomCode: currentRoomCode,
      messageId: id,
      emoji: emoji,
      senderUsername: username,
      senderUserId: (currentUser && currentUser.id) || socket.id
    });
    updateMessageReaction(id, emoji, username);

    // Auto-close reaction toolbar immediately after reacting (WhatsApp style)
    const toolbar = document.getElementById(`reactions-toolbar-${id}`);
    if (toolbar) {
      toolbar.classList.remove('active');
      toolbar.classList.add('closed');
    }
  };

  window.jumpToMessage = function (id) {
    const msgEl = document.getElementById(`msg-${id}`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('pulse');
      setTimeout(() => msgEl.classList.remove('pulse'), 1500);
    }
  };

  function updateMessageReaction(messageId, emoji, user) {
    const msg = messageStore.get(messageId);
    if (!msg) return;

    if (!msg.reactions) {
      msg.reactions = {};
    }

    // Check if user already reacted with this exact emoji
    const alreadyHasThisEmoji = msg.reactions[emoji] && (
      (msg.reactions[emoji] instanceof Set && msg.reactions[emoji].has(user)) ||
      (Array.isArray(msg.reactions[emoji]) && msg.reactions[emoji].includes(user))
    );

    // Enforce strictly ONE reaction per user per message (remove user from all existing emoji Sets on this message)
    for (const [e, userSet] of Object.entries(msg.reactions)) {
      if (userSet instanceof Set) {
        userSet.delete(user);
      } else if (Array.isArray(userSet)) {
        msg.reactions[e] = userSet.filter(u => u !== user);
      }
    }

    // If user clicked a different emoji (or was new), add user to the target emoji Set (if same emoji, it toggled off)
    if (!alreadyHasThisEmoji) {
      if (!(msg.reactions[emoji] instanceof Set)) {
        const existing = Array.isArray(msg.reactions[emoji]) ? msg.reactions[emoji] : [];
        msg.reactions[emoji] = new Set(existing);
      }
      msg.reactions[emoji].add(user);
    }

    const badgeContainer = document.getElementById(`reaction-badge-${messageId}`);
    if (!badgeContainer) return;

    let emojisUsed = [];
    let totalCount = 0;
    for (const [e, userSet] of Object.entries(msg.reactions)) {
      const count = (userSet instanceof Set) ? userSet.size : (Array.isArray(userSet) ? userSet.length : 0);
      if (count > 0) {
        emojisUsed.push(e);
        totalCount += count;
      }
    }

    if (totalCount > 0) {
      badgeContainer.classList.remove('hidden');
      badgeContainer.innerHTML = `<span>${emojisUsed.join('')}</span> ${totalCount > 1 ? `<span class="reaction-count">${totalCount}</span>` : ''}`;
    } else {
      badgeContainer.classList.add('hidden');
      badgeContainer.innerHTML = '';
    }
  }

  async function handleSendMessage() {
    const text = messageInput.value.trim();

    if (!selectedFile && !text) return;

    const isReady = await ensureE2EEActive();
    if (!isReady) {
      showToast('⚠️ Waiting for peer to connect and complete security key exchange...');
      return;
    }

    // Handle 15-min Message Editing Mode
    if (activeEditMessage && text) {
      const encrypted = await window.e2ee.encrypt(text, false);
      const payload = {
        id: activeEditMessage.id,
        isBinary: false,
        mediaType: 'text',
        payload: encrypted
      };

      socket.emit('edit-encrypted-message', {
        roomCode: currentRoomCode,
        messageId: activeEditMessage.id,
        encryptedPayload: payload
      });

      const msgData = messageStore.get(activeEditMessage.id);
      if (msgData) {
        msgData.content = text;
        msgData.isEdited = true;
      }

      const textEl = document.getElementById(`msg-text-${activeEditMessage.id}`);
      if (textEl) {
        textEl.innerHTML = `${escapeHtml(text)} <span class="edited-tag">(edited)</span>`;
      }

      activeEditMessage = null;
      if (editPreviewBar) editPreviewBar.classList.add('hidden');
      messageInput.value = '';
      showToast('✏️ Message edited successfully!');
      return;
    }

    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const replyData = activeReplyMessage ? { ...activeReplyMessage } : null;

    if (selectedFile) {
      // Handle File / Image Upload E2EE
      const reader = new FileReader();
      reader.onload = async (e) => {
        const arrayBuffer = e.target.result;
        const encrypted = await window.e2ee.encrypt(arrayBuffer, true);
        const mediaType = selectedFile.type.startsWith('image/') ? 'image' : 'file';

        const payload = {
          id: messageId,
          isBinary: true,
          mediaType: mediaType,
          replyTo: replyData,
          meta: {
            fileName: selectedFile.name,
            fileSize: formatBytes(selectedFile.size),
            mimeType: selectedFile.type
          },
          payload: encrypted
        };

        socket.emit('send-encrypted-message', {
          roomCode: currentRoomCode,
          userId: currentUser.uid,
          encryptedPayload: payload
        });

        const base64Data = window.e2ee.arrayBufferToBase64(arrayBuffer);
        const mime = selectedFile.type || 'application/octet-stream';
        const dataUrl = `data:${mime};base64,${base64Data}`;

        appendMessageToFeed({
          id: messageId,
          sender: currentUser.username,
          isOwn: true,
          content: dataUrl,
          mediaType: mediaType,
          fileName: selectedFile.name,
          fileSize: formatBytes(selectedFile.size),
          replyTo: replyData,
          createdTime: Date.now(),
          timestamp: timeString
        });

        clearAttachment();
        if (replyPreviewBar) replyPreviewBar.classList.add('hidden');
        activeReplyMessage = null;
      };
      reader.readAsArrayBuffer(selectedFile);

    } else if (text) {
      // Handle Text Message E2EE
      const encrypted = await window.e2ee.encrypt(text, false);

      const payload = {
        id: messageId,
        isBinary: false,
        mediaType: 'text',
        replyTo: replyData,
        senderUserId: currentUser.uid,
        senderUsername: currentUser.username,
        payload: encrypted
      };

      socket.emit('send-encrypted-message', {
        roomCode: currentRoomCode,
        userId: currentUser.uid,
        encryptedPayload: payload
      });

      saveLocalMessageHistory(currentRoomCode, {
        id: messageId,
        senderUserId: currentUser.uid,
        senderUsername: currentUser.username,
        encryptedPayload: payload,
        timestamp: new Date().toISOString()
      });

      appendMessageToFeed({
        id: messageId,
        sender: currentUser.username,
        isOwn: true,
        content: text,
        mediaType: 'text',
        replyTo: replyData,
        createdTime: Date.now(),
        timestamp: timeString
      });

      messageInput.value = '';
      messageInput.style.height = 'auto';
      if (replyPreviewBar) replyPreviewBar.classList.add('hidden');
      activeReplyMessage = null;
    }

    socket.emit('typing', { roomCode: currentRoomCode, isTyping: false });
  }

  // File Input Triggers
  btnAttach.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) { // 8MB safety limit
      alert('File size exceeds 8MB limit for WebSocket transmission.');
      return;
    }

    selectedFile = file;
    attachmentFilename.textContent = file.name;
    attachmentSize.textContent = `(${formatBytes(file.size)})`;
    attachmentPreview.classList.remove('hidden');
  });

  btnCancelAttachment.addEventListener('click', clearAttachment);

  function clearAttachment() {
    selectedFile = null;
    fileInput.value = '';
    attachmentPreview.classList.add('hidden');
  }

  // =========================================================================
  // VOICE NOTE RECORDING & PERMISSION FLOW (MEDIARECORDER API)
  // =========================================================================

  // Polyfill getUserMedia for cross-browser & mobile device compatibility
  if (typeof navigator !== 'undefined') {
    if (!navigator.mediaDevices) {
      navigator.mediaDevices = {};
    }
    if (!navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia = function (constraints) {
        const legacyGetUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
        if (!legacyGetUserMedia) {
          return Promise.reject(new Error('Microphone recording is not supported on this browser or environment.'));
        }
        return new Promise((resolve, reject) => {
          legacyGetUserMedia.call(navigator, constraints, resolve, reject);
        });
      };
    }
  }

  let activeMicStream = null;
  let recordedAudioMime = 'audio/webm';
  let selectedAudioDeviceId = null;
  const micPermissionModal = document.getElementById('mic-permission-modal');
  const btnCloseMicModal = document.getElementById('btn-close-mic-modal');
  const btnRetryMicPermission = document.getElementById('btn-retry-mic-permission');
  const btnMicSelector = document.getElementById('btn-mic-selector');
  const micSelectorDropdown = document.getElementById('mic-selector-dropdown');
  const micDeviceList = document.getElementById('mic-device-list');

  function getAudioConstraints() {
    const audioObj = {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true }
    };
    if (selectedAudioDeviceId && selectedAudioDeviceId !== 'default') {
      audioObj.deviceId = { ideal: selectedAudioDeviceId };
    }
    return { audio: audioObj };
  }

  async function populateAudioDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');

      if (!micDeviceList) return;
      micDeviceList.innerHTML = '';

      const defaultOpt = document.createElement('div');
      defaultOpt.className = `mic-device-option ${!selectedAudioDeviceId || selectedAudioDeviceId === 'default' ? 'selected' : ''}`;
      defaultOpt.dataset.deviceId = 'default';
      defaultOpt.innerHTML = '<i class="fa-solid fa-mobile-screen"></i> 📱 Built-in Device Microphone (Default)';
      defaultOpt.addEventListener('click', async () => {
        document.querySelectorAll('.mic-device-option').forEach(o => o.classList.remove('selected'));
        defaultOpt.classList.add('selected');
        selectedAudioDeviceId = null;
        if (micSelectorDropdown) micSelectorDropdown.classList.add('hidden');
        stopMicStream();
        await requestMicrophonePermissionProactively();
        showToast('Selected: 📱 Built-in Device Microphone');
      });
      micDeviceList.appendChild(defaultOpt);

      audioInputs.forEach((device, idx) => {
        if (!device.deviceId || device.deviceId === 'default') return;
        const isSelected = (selectedAudioDeviceId === device.deviceId);
        let label = device.label || `Microphone Input ${idx + 1}`;
        let iconClass = 'fa-solid fa-microphone';
        const lower = label.toLowerCase();
        if (lower.includes('built-in') || lower.includes('internal') || lower.includes('speaker') || lower.includes('phone') || lower.includes('integrated')) {
          iconClass = 'fa-solid fa-mobile-screen';
          label = `📱 ${label}`;
        } else if (lower.includes('headset') || lower.includes('earphone') || lower.includes('bluetooth') || lower.includes('airpods')) {
          iconClass = 'fa-solid fa-headphones';
          label = `🎧 ${label}`;
        } else {
          label = `🎙️ ${label}`;
        }

        const opt = document.createElement('div');
        opt.className = `mic-device-option ${isSelected ? 'selected' : ''}`;
        opt.dataset.deviceId = device.deviceId;
        opt.innerHTML = `<i class="${iconClass}"></i> ${escapeHtml(label)}`;

        opt.addEventListener('click', async () => {
          document.querySelectorAll('.mic-device-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          selectedAudioDeviceId = device.deviceId;
          if (micSelectorDropdown) micSelectorDropdown.classList.add('hidden');
          stopMicStream();
          await requestMicrophonePermissionProactively();
          showToast(`Selected: ${label}`);
        });

        micDeviceList.appendChild(opt);
      });
    } catch (e) {
      console.warn('Audio input device enumeration notice:', e);
    }
  }

  if (btnMicSelector) {
    btnMicSelector.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (micSelectorDropdown) {
        micSelectorDropdown.classList.toggle('hidden');
        if (!micSelectorDropdown.classList.contains('hidden')) {
          await populateAudioDevices();
        }
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (micSelectorDropdown && !micSelectorDropdown.classList.contains('hidden')) {
      if (!micSelectorDropdown.contains(e.target) && e.target !== btnMicSelector) {
        micSelectorDropdown.classList.add('hidden');
      }
    }
  });

  function stopMicStream() {
    if (activeMicStream) {
      try {
        activeMicStream.getTracks().forEach(track => track.stop());
      } catch (e) {
        console.warn('Error releasing mic stream tracks:', e);
      }
      activeMicStream = null;
    }
  }

  if (btnCloseMicModal) {
    btnCloseMicModal.addEventListener('click', () => {
      if (micPermissionModal) micPermissionModal.classList.add('hidden');
    });
  }

  if (btnRetryMicPermission) {
    btnRetryMicPermission.addEventListener('click', async () => {
      if (micPermissionModal) micPermissionModal.classList.add('hidden');
      await startVoiceRecording();
    });
  }

  async function startVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;

    try {
      if (!activeMicStream || !activeMicStream.getAudioTracks().some(t => t.readyState === 'live')) {
        activeMicStream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
      }
      const stream = activeMicStream;
      audioChunks = [];

      const candidateTypes = [
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/aac',
        'audio/ogg',
        'audio/wav'
      ];
      const supportedMime = (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function')
        ? (candidateTypes.find(t => MediaRecorder.isTypeSupported(t)) || '')
        : '';

      recordedAudioMime = supportedMime || 'audio/webm';
      mediaRecorder = supportedMime ? new MediaRecorder(stream, { mimeType: supportedMime }) : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.start(100);
      startVoiceTimer();
      if (voiceRecordingBar) voiceRecordingBar.classList.remove('hidden');
      if (micPermissionModal) micPermissionModal.classList.add('hidden');
      showSystemNotification('🎙️ Recording voice note...');

    } catch (err) {
      console.warn("Primary mic stream access state:", err);
      try {
        activeMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const stream = activeMicStream;
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.start(100);
        startVoiceTimer();
        if (voiceRecordingBar) voiceRecordingBar.classList.remove('hidden');
        if (micPermissionModal) micPermissionModal.classList.add('hidden');
      } catch (fallbackErr) {
        console.error("Microphone stream access error:", fallbackErr);
        if (micPermissionModal) micPermissionModal.classList.remove('hidden');
        showToast('🎙️ Microphone access required to record voice notes.');
      }
    }
  }

  if (btnRecordVoice) {
    btnRecordVoice.addEventListener('click', startVoiceRecording);
  }

  if (btnCancelVoice) {
    btnCancelVoice.addEventListener('click', () => {
      stopVoiceTimer();
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.stop();
      }
      audioChunks = [];
      if (voiceRecordingBar) voiceRecordingBar.classList.add('hidden');
      showToast('🗑️ Voice note discarded');
    });
  }

  if (btnSendVoice) {
    btnSendVoice.addEventListener('click', () => {
      if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

      mediaRecorder.onstop = async () => {
        stopVoiceTimer();
        if (voiceRecordingBar) voiceRecordingBar.classList.add('hidden');

        if (audioChunks.length === 0) {
          showSystemNotification('⚠️ No audio data recorded.');
          return;
        }

        const mime = recordedAudioMime || 'audio/webm';
        const audioBlob = new Blob(audioChunks, { type: mime });
        audioChunks = [];
        const arrayBuffer = await audioBlob.arrayBuffer();

        const base64Audio = window.e2ee.arrayBufferToBase64(arrayBuffer);
        const audioDataUrl = `data:${mime};base64,${base64Audio}`;

        const encrypted = await window.e2ee.encrypt(arrayBuffer, true);
        const messageId = 'voice_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const payload = {
          id: messageId,
          isBinary: true,
          mediaType: 'voice',
          senderUserId: currentUser.uid,
          senderUsername: currentUser.username,
          meta: { mimeType: mime, duration: recordingSeconds },
          payload: encrypted
        };

        socket.emit('send-encrypted-message', {
          roomCode: currentRoomCode,
          userId: currentUser.uid,
          encryptedPayload: payload
        });

        appendMessageToFeed({
          id: messageId,
          sender: currentUser.username,
          isOwn: true,
          content: audioDataUrl,
          mediaType: 'voice',
          timestamp: timeString
        });
      };

      try {
        if (typeof mediaRecorder.requestData === 'function') {
          mediaRecorder.requestData();
        }
      } catch (e) { }

      mediaRecorder.stop();
    });
  }

  function startVoiceTimer() {
    recordingSeconds = 0;
    voiceTimer.textContent = '00:00';
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = setInterval(() => {
      recordingSeconds++;
      const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const secs = String(recordingSeconds % 60).padStart(2, '0');
      voiceTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopVoiceTimer() {
    clearInterval(recordingTimerInterval);
  }

  // Custom Voice Note Player Logic
  window.playVoiceNote = function (id) {
    const container = document.getElementById(`wa-voice-${id}`);
    if (!container) return;
    const audio = container.querySelector('audio');
    const playBtnIcon = container.querySelector('.voice-play-btn i');
    const seekbar = container.querySelector('.voice-seekbar');
    const durationText = container.querySelector('.voice-duration');

    if (!audio) return;

    // Pause all other active voice note playback
    document.querySelectorAll('.voice-note-player audio').forEach(a => {
      if (a !== audio) {
        a.pause();
        const pId = a.dataset.msgId;
        if (pId) {
          const pIcon = document.querySelector(`#wa-voice-${pId} .voice-play-btn i`);
          if (pIcon) pIcon.className = 'fa-solid fa-play';
        }
      }
    });

    if (audio.paused) {
      if (audio.readyState === 0) {
        audio.load();
      }
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          if (playBtnIcon) playBtnIcon.className = 'fa-solid fa-pause';
        }).catch(err => {
          console.warn('Audio playback error:', err);
          showToast('🔊 Tap play again to enable audio on mobile');
        });
      }
    } else {
      audio.pause();
      if (playBtnIcon) playBtnIcon.className = 'fa-solid fa-play';
    }

    audio.ontimeupdate = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        const pct = (audio.currentTime / audio.duration) * 100;
        if (seekbar) seekbar.value = pct;
        const mins = String(Math.floor(audio.currentTime / 60)).padStart(2, '0');
        const secs = String(Math.floor(audio.currentTime % 60)).padStart(2, '0');
        if (durationText) durationText.textContent = `${mins}:${secs}`;
      }
    };

    audio.onended = () => {
      if (playBtnIcon) playBtnIcon.className = 'fa-solid fa-play';
      if (seekbar) seekbar.value = 0;
    };
  };

  window.seekVoiceNote = function (id, val) {
    const container = document.getElementById(`wa-voice-${id}`);
    if (!container) return;
    const audio = container.querySelector('audio');
    if (audio && audio.duration && !isNaN(audio.duration)) {
      audio.currentTime = (val / 100) * audio.duration;
    }
  };

  window.toggleVoiceSpeed = function (id) {
    const container = document.getElementById(`wa-voice-${id}`);
    if (!container) return;
    const audio = container.querySelector('audio');
    const speedBtn = container.querySelector('.voice-speed-btn');
    if (!audio) return;

    const currentSpeed = audio.playbackRate || 1;
    let nextSpeed = 1;
    if (currentSpeed === 1) nextSpeed = 1.5;
    else if (currentSpeed === 1.5) nextSpeed = 2;
    else nextSpeed = 1;

    audio.playbackRate = nextSpeed;
    if (speedBtn) speedBtn.textContent = `${nextSpeed}x`;
  };

  // =========================================================================
  // UI FEED & UTILITY HELPERS
  // =========================================================================

  function fixFileNameAndMime(rawName, rawMime, bytes) {
    let name = rawName || 'document';
    let mime = rawMime || 'application/octet-stream';

    // Magic Bytes Detection for PDF (%PDF -> 0x25, 0x50, 0x44, 0x46)
    if (bytes && bytes.length >= 4) {
      if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        mime = 'application/pdf';
        if (!name.toLowerCase().endsWith('.pdf')) {
          name = name.replace(/\.[^/.]+$/, '') + '.pdf';
        }
      }
      // PNG (0x89, 0x50, 0x4E, 0x47)
      else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        mime = 'image/png';
        if (!name.toLowerCase().endsWith('.png')) {
          name = name.replace(/\.[^/.]+$/, '') + '.png';
        }
      }
      // JPEG (0xFF, 0xD8, 0xFF)
      else if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        mime = 'image/jpeg';
        if (!name.toLowerCase().endsWith('.jpg') && !name.toLowerCase().endsWith('.jpeg')) {
          name = name.replace(/\.[^/.]+$/, '') + '.jpg';
        }
      }
      // ZIP / DOCX / XLSX / PPTX (0x50, 0x4B, 0x03, 0x04)
      else if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
        if (!name.includes('.')) name = name + '.docx';
      }
    }

    if (!name.includes('.')) {
      if (mime.includes('pdf')) name += '.pdf';
      else if (mime.includes('png')) name += '.png';
      else if (mime.includes('jpeg') || mime.includes('jpg')) name += '.jpg';
      else if (mime.includes('word') || mime.includes('docx')) name += '.docx';
      else if (mime.includes('excel') || mime.includes('xlsx')) name += '.xlsx';
      else if (mime.includes('zip')) name += '.zip';
    }

    return { name, mime };
  }

  // Programmatic File Download Helper (Prevents Chrome "File can't be downloaded securely" Blob warning & preserves PDF format)
  window.downloadAttachment = function (id) {
    const msg = messageStore.get(id);
    if (!msg || !msg.content) {
      showToast('⚠️ File content unavailable for download.');
      return;
    }

    const content = msg.content;
    let rawName = msg.fileName || 'download';
    let rawMime = 'application/octet-stream';

    try {
      if (typeof content === 'string' && content.startsWith('data:')) {
        const parts = content.split(';base64,');
        rawMime = parts[0].replace('data:', '') || 'application/octet-stream';
        const binaryStr = window.atob(parts[1]);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const { name, mime } = fixFileNameAndMime(rawName, rawMime, bytes);
        const blob = new Blob([bytes], { type: mime });
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 1000);
        showToast(`📥 Downloading ${name}...`);
      } else if (typeof content === 'string' && content.startsWith('blob:')) {
        const { name } = fixFileNameAndMime(rawName, rawMime, null);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = content;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 1000);
        showToast(`📥 Downloading ${name}...`);
      } else {
        const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
        const { name, mime } = fixFileNameAndMime(rawName, rawMime, bytes);
        const blob = new Blob([bytes], { type: mime });
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 1000);
        showToast(`📥 Downloading ${name}...`);
      }
    } catch (e) {
      console.error('Download error:', e);
      showToast('⚠️ Download failed. Please try again.');
    }
  };

  function appendMessageToFeed({ id, sender, isOwn, content, mediaType, fileName, fileSize, replyTo, createdTime, timestamp }) {
    createdTime = createdTime || Date.now();
    const msgObj = {
      id,
      sender,
      isOwn,
      content,
      mediaType,
      fileName,
      fileSize,
      replyTo,
      createdTime,
      timestamp,
      isEdited: false,
      isStarred: false,
      reactions: {}
    };
    messageStore.set(id, msgObj);

    const row = document.createElement('div');
    row.className = `message-row ${isOwn ? 'own-message' : 'peer-message'}`;
    row.id = `msg-${id}`;

    let replyBoxHtml = '';
    if (replyTo) {
      replyBoxHtml = `
        <div class="quoted-reply-box" onclick="jumpToMessage('${replyTo.id}')">
          <span class="quoted-sender"><i class="fa-solid fa-reply"></i> ${escapeHtml(replyTo.sender)}</span>
          <span class="quoted-snippet">${escapeHtml(replyTo.text)}</span>
        </div>`;
    }

    let bodyHtml = '';
    if (mediaType === 'image') {
      bodyHtml = `
        <div style="position:relative; display:inline-block; max-width:100%;">
          <img src="${content}" alt="Attachment" class="message-media-img">
          <button type="button" onclick="downloadAttachment('${id}')" class="btn btn-sm btn-outline" style="margin-top:6px; width:100%; display:flex; align-items:center; justify-content:center; gap:6px;">
            <i class="fa-solid fa-download"></i> Download Image
          </button>
        </div>`;
    } else if (mediaType === 'file') {
      bodyHtml = `
        <div class="file-attachment-card">
          <i class="fa-solid fa-file-arrow-down"></i>
          <div>
            <div><strong>${escapeHtml(fileName || 'Download File')}</strong></div>
            <span class="text-muted" style="font-size:0.75rem">${fileSize || ''}</span>
          </div>
          <button type="button" onclick="downloadAttachment('${id}')" class="btn btn-sm btn-outline ml-auto" style="display:flex; align-items:center; gap:6px;">
            <i class="fa-solid fa-download"></i> Download
          </button>
        </div>`;
    } else if (mediaType === 'voice') {
      bodyHtml = `
        <div class="voice-note-player" id="wa-voice-${id}">
          <audio data-msg-id="${id}" playsinline preload="auto" src="${content}"></audio>
          <button type="button" class="voice-play-btn" aria-label="Play Voice Note" onclick="playVoiceNote('${id}')">
            <i class="fa-solid fa-play"></i>
          </button>
          <div class="voice-center">
            <div class="voice-waveform">
              <input type="range" class="voice-seekbar" min="0" max="100" value="0" oninput="seekVoiceNote('${id}', this.value)">
            </div>
            <div class="voice-meta">
              <span class="voice-duration">00:00</span>
              <span class="voice-badge"><i class="fa-solid fa-microphone"></i> Voice Note</span>
            </div>
          </div>
          <button type="button" class="voice-speed-btn" title="Toggle Playback Speed" onclick="toggleVoiceSpeed('${id}')">1x</button>
        </div>`;
    } else {
      bodyHtml = `<div id="msg-text-${id}">${escapeHtml(content)}</div>`;
    }

    const ticks = isOwn ? `<span class="read-tick"><i class="fa-solid fa-check"></i></span>` : '';

    const canEdit = isOwn && mediaType === 'text';

    // Floating Quick Reactions Popover Toolbar
    const reactionsToolbarHtml = buildReactionsToolbarHtml(id);

    // Chevron Context Menu Dropdown
    const chevronMenuHtml = `
      <button class="message-chevron-btn" title="Message Options" onclick="toggleMessageMenu('${id}', event)">
        <i class="fa-solid fa-chevron-down"></i>
      </button>
      <div id="msg-menu-${id}" class="message-menu-dropdown hidden">
        <div class="message-menu-item" onclick="triggerReplyMessage('${id}'); toggleMessageMenu('${id}');"><i class="fa-solid fa-reply text-primary"></i> Reply</div>
        ${canEdit ? `<div class="message-menu-item" onclick="triggerEditMessage('${id}'); toggleMessageMenu('${id}');"><i class="fa-solid fa-pen text-emerald"></i> Edit</div>` : ''}
        <div class="message-menu-item" onclick="triggerStarMessage('${id}'); toggleMessageMenu('${id}');"><i class="fa-solid fa-star text-warning"></i> Star Message</div>
        <div class="message-menu-item" onclick="triggerPinMessage('${id}'); toggleMessageMenu('${id}');"><i class="fa-solid fa-thumbtack text-accent"></i> Pin Message</div>
      </div>
    `;

    row.innerHTML = `
      <div class="message-bubble-wrapper">
        ${reactionsToolbarHtml}
        <div class="message-sender-name">${escapeHtml(sender)}</div>
        <div class="message-bubble ${isOwn ? 'own' : 'peer'}">
          ${chevronMenuHtml}
          ${replyBoxHtml}
          ${bodyHtml}
          <div class="message-meta" id="msg-meta-${id}">
            <i class="fa-solid fa-lock" style="font-size:0.6rem; color:var(--emerald)" title="E2EE Encrypted"></i>
            <span>${timestamp}</span>
            <span id="star-badge-${id}"></span>
            ${ticks}
          </div>
          <div id="reaction-badge-${id}" class="reaction-badge hidden"></div>
        </div>
      </div>
    `;

    chatFeed.appendChild(row);
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  window.toggleMessageMenu = function (id, event) {
    if (event) event.stopPropagation();
    document.querySelectorAll('.message-menu-dropdown').forEach(el => {
      if (el.id !== `msg-menu-${id}`) el.classList.add('hidden');
    });
    const menu = document.getElementById(`msg-menu-${id}`);
    if (menu) menu.classList.toggle('hidden');
  };

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.message-menu-dropdown').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.reactions-toolbar.active').forEach(tb => {
      tb.classList.remove('active');
      tb.classList.add('closed');
    });

    if (emojiPickerModal && !emojiPickerModal.classList.contains('hidden')) {
      const modalContent = emojiPickerModal.querySelector('.modal-content');
      if (modalContent && !modalContent.contains(e.target) && !e.target.closest('.reaction-add-btn')) {
        closeEmojiPickerModal();
      }
    }
  });

  // Double-tap & Double-click on message bubble to open reaction toolbar (WhatsApp style)
  let lastTapTime = 0;
  let lastTapMsgId = null;

  if (chatFeed) {
    chatFeed.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, a, input, audio, .message-chevron-btn')) return;
      const bubbleWrapper = e.target.closest('.message-bubble-wrapper');
      if (!bubbleWrapper) return;
      const msgRow = bubbleWrapper.closest('.message-row');
      if (msgRow && msgRow.id) {
        const msgId = msgRow.id.replace('msg-', '');
        toggleReactionToolbar(msgId, e);
      }
    });

    chatFeed.addEventListener('touchend', (e) => {
      if (e.target.closest('button, a, input, audio, .message-chevron-btn')) return;
      const bubbleWrapper = e.target.closest('.message-bubble-wrapper');
      if (!bubbleWrapper) return;

      const msgRow = bubbleWrapper.closest('.message-row');
      if (!msgRow || !msgRow.id) return;

      const msgId = msgRow.id.replace('msg-', '');
      const now = Date.now();
      const timeDiff = now - lastTapTime;

      if (timeDiff < 320 && lastTapMsgId === msgId) {
        e.preventDefault();
        toggleReactionToolbar(msgId, e);
        lastTapTime = 0;
        lastTapMsgId = null;
      } else {
        lastTapTime = now;
        lastTapMsgId = msgId;
      }
    });
  }

  function showSystemNotification(text) {
    const sys = document.createElement('div');
    sys.className = 'system-message';
    sys.innerHTML = `
      <div class="system-pill">
        <i class="fa-solid fa-circle-info"></i>
        <span>${escapeHtml(text)}</span>
      </div>
    `;
    chatFeed.appendChild(sys);
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  function setupPeerInfo(user) {
    peerUser = user;
    chatPeerAvatar.textContent = user.avatar || '⚡';
    chatPeerName.textContent = user.username || 'Participant';
    peerStatusDot.className = 'status-dot online';
  }

  function enterChatRoom() {
    chatRoomCodeText.textContent = currentRoomCode;
    const appWrapper = document.getElementById('app-root');
    if (appWrapper) appWrapper.classList.add('in-chat');
    switchScreen(stepPortal, stepChat);
  }

  function switchScreen(fromEl, toEl) {
    fromEl.classList.add('hidden');
    toEl.classList.remove('hidden');
  }

  // Verification Modal Handlers (guarded if element exists)
  if (typeof btnVerifyKeys !== 'undefined' && btnVerifyKeys && typeof verifyModal !== 'undefined' && verifyModal) {
    btnVerifyKeys.addEventListener('click', () => verifyModal.classList.remove('hidden'));
  }
  if (typeof btnCloseModal !== 'undefined' && btnCloseModal && typeof verifyModal !== 'undefined' && verifyModal) {
    btnCloseModal.addEventListener('click', () => verifyModal.classList.add('hidden'));
  }

  // Leave Room Handler
  btnLeaveRoom.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this encrypted room session?')) {
      socket.emit('leave-room');
      window.location.href = '/';
    }
  });

  async function computeFingerprint(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
  }

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'glass-pill';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
    toast.innerHTML = `<i class="fa-solid fa-check-circle text-emerald"></i> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }
});
