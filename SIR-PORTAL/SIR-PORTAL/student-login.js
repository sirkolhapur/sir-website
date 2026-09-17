/* =========================================================
   SIR STUDENT & PARENT PORTAL
   Student Login — Frontend Controller
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    const loginForm = document.getElementById("student-login-form");
    const uidInput = document.getElementById("student-uid");
    const passwordInput = document.getElementById("student-password");
    const loginMessage = document.getElementById("login-message");
    const loginButton = loginForm
        ? loginForm.querySelector(".login-button")
        : null;


    /* =====================================================
       SAFETY CHECK
       ===================================================== */

    if (!loginForm || !uidInput || !passwordInput || !loginMessage) {
        console.warn("SIR Portal: Login elements not found.");
        return;
    }


    /* =====================================================
       MESSAGE HANDLER
       ===================================================== */

    function showMessage(message) {
        loginMessage.textContent = message;
    }


    /* =====================================================
       FORM SUBMISSION
       ===================================================== */

    loginForm.addEventListener("submit", (event) => {

        event.preventDefault();

        const uid = uidInput.value.trim();
        const password = passwordInput.value.trim();


        /* ---------------------------------------------
           BASIC VALIDATION
           --------------------------------------------- */

        if (!uid) {
            showMessage("Please enter your Student UID.");
            uidInput.focus();
            return;
        }

        if (!password) {
            showMessage("Please enter your password or PIN.");
            passwordInput.focus();
            return;
        }


        /* ---------------------------------------------
           FRONTEND PROTOTYPE STATE
           ---------------------------------------------

           IMPORTANT:
           No real credentials are stored in this file.

           Authentication will later be connected to
           the secure SIR backend/database.

           Current behaviour is intentionally limited
           to informing the user that the portal is
           ready for backend authentication.
           --------------------------------------------- */

        showMessage(
            "Secure student authentication will be connected here."
        );

        console.log("SIR Portal login request prepared:", {
            studentUID: uid
        });

    });


    /* =====================================================
       INPUT CLEANUP
       ===================================================== */

    uidInput.addEventListener("input", () => {
        loginMessage.textContent = "";
    });

    passwordInput.addEventListener("input", () => {
        loginMessage.textContent = "";
    });


    /* =====================================================
       ENTER KEY SUPPORT
       ===================================================== */

    passwordInput.addEventListener("keydown", (event) => {

        if (event.key === "Enter") {
            loginForm.requestSubmit();
        }

    });


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    loginMessage.textContent = "";

});
