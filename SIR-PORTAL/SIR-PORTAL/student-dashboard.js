/* =========================================================
   SIR STUDENT & PARENT PORTAL
   STUDENT DASHBOARD
   Frontend Controller
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    /* =====================================================
       ELEMENTS
       ===================================================== */

    const logoutButton = document.getElementById("logout-button");

    const dashboardUID =
        document.getElementById("dashboard-uid");

    const studentName =
        document.getElementById("student-name");

    const studentStatus =
        document.getElementById("student-status");

    const profileName =
        document.getElementById("profile-name");

    const profileUID =
        document.getElementById("profile-uid");

    const profileCourse =
        document.getElementById("profile-course");

    const profileBatch =
        document.getElementById("profile-batch");

    const profileYear =
        document.getElementById("profile-year");

    const profileStatus =
        document.getElementById("profile-status");


    /* =====================================================
       DEMO / PLACEHOLDER DATA
       =====================================================

       IMPORTANT:

       This is NOT real student data.

       No real credentials or student information should
       be stored inside frontend JavaScript.

       Later this object will be replaced by authenticated
       data received securely from the SIR backend/database.
       ===================================================== */

    const studentData = {
        uid: "SIR-XXXX",
        name: "Student",
        course: "NEET / JEE",
        batch: "Current Batch",
        academicYear: "2026–27",
        status: "Active"
    };


    /* =====================================================
       LOAD STUDENT INFORMATION
       ===================================================== */

    function loadStudentInformation() {

        if (dashboardUID) {
            dashboardUID.textContent = studentData.uid;
        }

        if (studentName) {
            studentName.textContent = studentData.name;
        }

        if (studentStatus) {
            studentStatus.textContent = studentData.status;
        }

        if (profileName) {
            profileName.textContent = studentData.name;
        }

        if (profileUID) {
            profileUID.textContent = studentData.uid;
        }

        if (profileCourse) {
            profileCourse.textContent = studentData.course;
        }

        if (profileBatch) {
            profileBatch.textContent = studentData.batch;
        }

        if (profileYear) {
            profileYear.textContent = studentData.academicYear;
        }

        if (profileStatus) {
            profileStatus.textContent = studentData.status;
        }
    }


    /* =====================================================
       LOAD PLACEHOLDER ANALYTICS
       ===================================================== */

    function loadAnalyticsPlaceholders() {

        const average =
            document.getElementById("overall-average");

        const tests =
            document.getElementById("tests-attempted");

        const strongest =
            document.getElementById("strongest-subject");

        const lastReview =
            document.getElementById("last-review");

        const analyticsAverage =
            document.getElementById("analytics-average");

        const analyticsMean =
            document.getElementById("analytics-mean");

        const analyticsMedian =
            document.getElementById("analytics-median");

        const analyticsMode =
            document.getElementById("analytics-mode");


        if (average) {
            average.textContent = "—";
        }

        if (tests) {
            tests.textContent = "—";
        }

        if (strongest) {
            strongest.textContent = "—";
        }

        if (lastReview) {
            lastReview.textContent = "—";
        }

        if (analyticsAverage) {
            analyticsAverage.textContent = "—";
        }

        if (analyticsMean) {
            analyticsMean.textContent = "—";
        }

        if (analyticsMedian) {
            analyticsMedian.textContent = "—";
        }

        if (analyticsMode) {
            analyticsMode.textContent = "—";
        }
    }


    /* =====================================================
       RESULTS
       ===================================================== */

    function loadResults() {

        const resultsBody =
            document.getElementById("results-table-body");

        if (!resultsBody) {
            return;
        }

        /*
         * Real test results will later be received from
         * the SIR database through the authenticated backend.
         */

        resultsBody.innerHTML = `
            <tr>
                <td colspan="5">
                    No result data available yet.
                </td>
            </tr>
        `;
    }


    /* =====================================================
       SUBJECT PERFORMANCE
       ===================================================== */

    function loadSubjectPerformance() {

        const subjectList =
            document.getElementById(
                "subject-performance-list"
            );

        if (!subjectList) {
            return;
        }

        subjectList.innerHTML = `
            <div class="empty-state">
                Subject-wise performance will appear here
                once academic data is available.
            </div>
        `;
    }


    /* =====================================================
       PROGRESS
       ===================================================== */

    function loadProgress() {

        const strengths =
            document.getElementById("strengths");

        const improvementAreas =
            document.getElementById("improvement-areas");

        const nextFocus =
            document.getElementById("next-focus");


        if (strengths) {
            strengths.textContent =
                "Your identified academic strengths will appear here.";
        }

        if (improvementAreas) {
            improvementAreas.textContent =
                "Areas requiring additional attention will appear here.";
        }

        if (nextFocus) {
            nextFocus.textContent =
                "Your next academic focus will appear here.";
        }
    }


    /* =====================================================
       WEEKLY TEACHER REVIEW
       ===================================================== */

    function loadTeacherReview() {

        const reviewWeek =
            document.getElementById("review-week");

        const reviewDate =
            document.getElementById("review-date");

        const covered =
            document.getElementById("review-covered");

        const performance =
            document.getElementById("review-performance");

        const struggling =
            document.getElementById("review-struggling");

        const nextAction =
            document.getElementById("review-next-action");


        if (reviewWeek) {
            reviewWeek.textContent =
                "No weekly review available yet.";
        }

        if (reviewDate) {
            reviewDate.textContent = "—";
        }

        if (covered) {
            covered.textContent =
                "No review available yet.";
        }

        if (performance) {
            performance.textContent =
                "No review available yet.";
        }

        if (struggling) {
            struggling.textContent =
                "No review available yet.";
        }

        if (nextAction) {
            nextAction.textContent =
                "No review available yet.";
        }
    }


    /* =====================================================
       ACADEMIC UPDATES
       ===================================================== */

    function loadAcademicUpdates() {

        const updates =
            document.getElementById("academic-updates");

        if (!updates) {
            return;
        }

        updates.innerHTML = `
            <article class="update-item">

                <span>
                    UPDATE
                </span>

                <div>

                    <h3>
                        Academic updates will appear here.
                    </h3>

                    <p>
                        Important information shared by
                        SIR will be displayed in this section.
                    </p>

                </div>

            </article>
        `;
    }


    /* =====================================================
       LOGOUT
       ===================================================== */

    if (logoutButton) {

        logoutButton.addEventListener("click", () => {

            /*
             * Later this will also invalidate the secure
             * authentication session on the backend.
             */

            sessionStorage.removeItem("sirStudentSession");

            window.location.href =
                "student-login.html";

        });

    }


    /* =====================================================
       SESSION CHECK — FRONTEND PLACEHOLDER
       =====================================================

       We intentionally do NOT create fake authentication.

       When the backend is connected, this section will:

       1. Verify the authenticated session.
       2. Retrieve the student's UID.
       3. Fetch only that student's data.
       4. Populate the dashboard.
       5. Redirect unauthenticated users to login.
       ===================================================== */


    /* =====================================================
       INITIALIZE DASHBOARD
       ===================================================== */

    loadStudentInformation();

    loadAnalyticsPlaceholders();

    loadResults();

    loadSubjectPerformance();

    loadProgress();

    loadTeacherReview();

    loadAcademicUpdates();


    /* =====================================================
       DEVELOPMENT LOG
       ===================================================== */

    console.log(
        "SIR Student Dashboard loaded. " +
        "Ready for secure backend/database integration."
    );

});
