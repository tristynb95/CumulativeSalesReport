document.addEventListener('DOMContentLoaded', () => {
    // PASTE YOUR FIREBASE CONFIG OBJECT HERE
    const firebaseConfig = {
        apiKey: "AIzaSyADonW627WBvOI0VBKUT2NNsx3xs3TTpu4",
        authDomain: "cumulativesalesreport.firebaseapp.com",
        projectId: "cumulativesalesreport",
        storageBucket: "cumulativesalesreport.firebasestorage.app",
        messagingSenderId: "610993633409",
        appId: "1:610993633409:web:abaaf1e97bcd1acdafb580",
        measurementId: "G-CX4PTW2Y2F"
    };

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();

    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const authError = document.getElementById('auth-error');

    // Redirect if user is already logged in
    auth.onAuthStateChanged(user => {
        if (user) {
            window.location.href = '/index.html';
        }
    });

    const handleError = (error) => {
        authError.textContent = error.message;
    };

    loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const email = emailInput.value;
        const password = passwordInput.value;
        auth.signInWithEmailAndPassword(email, password).catch(handleError);
    });

    signupBtn.addEventListener('click', () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        auth.createUserWithEmailAndPassword(email, password).catch(handleError);
    });
});
