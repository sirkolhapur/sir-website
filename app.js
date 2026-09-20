/* =========================================================
   SIR — APP.JS
   WEBSITE + SUPABASE
   ========================================================= */


/* =========================================================
   01 — SUPABASE CONFIGURATION
   ========================================================= */

const SUPABASE_URL =
    "https://asbyosqpupqspzvqqhfj.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_5kLRY64Pv5Ct-ZXuNtgEAw_51YUDqyw";


const supabaseClient =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
    );


console.log("SIR Supabase connected.");



/* =========================================================
   02 — WEBSITE
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {


        /* =================================================
           STORY SECTIONS
        ================================================== */

        const sections =
            document.querySelectorAll(
                ".story-section"
            );


        /* =================================================
           MOBILE MENU
        ================================================== */

        const menuButton =
            document.querySelector(
                ".menu-toggle"
            );


        const brand =
            document.querySelector(
                ".brand"
            );


        /* =================================================
           STORY REVEAL
        ================================================== */

        const revealObserver =
            new IntersectionObserver(
                (entries) => {

                    entries.forEach(
                        (entry) => {

                            if (
                                entry.isIntersecting
                            ) {

                                entry.target.classList.add(
                                    "is-visible"
                                );

                            }

                        }
                    );

                },
                {
                    threshold: 0.12
                }
            );


        sections.forEach(
            (section) => {

                revealObserver.observe(
                    section
                );

            }
        );


        /* =================================================
           ACTIVE STORY
        ================================================== */

        const chapterObserver =
            new IntersectionObserver(
                (entries) => {

                    entries.forEach(
                        (entry) => {

                            if (
                                entry.isIntersecting
                            ) {

                                sections.forEach(
                                    (section) => {

                                        section.classList.remove(
                                            "active-story"
                                        );

                                    }
                                );


                                entry.target.classList.add(
                                    "active-story"
                                );

                            }

                        }
                    );

                },
                {
                    threshold: 0.55
                }
            );


        sections.forEach(
            (section) => {

                chapterObserver.observe(
                    section
                );

            }
        );


        /* =================================================
           HERO — FORCE VISIBLE
           ================================================== */

        const hero =
            document.querySelector(
                ".hero"
            );


        if (hero) {

            setTimeout(
                () => {

                    hero.classList.add(
                        "is-visible"
                    );

                },
                100
            );

        }


        /* =================================================
           MOBILE MENU OPEN / CLOSE
        ================================================== */

        function closeMobileMenu() {

            if (menuButton) {

                menuButton.setAttribute(
                    "aria-expanded",
                    "false"
                );

            }

            document.body.classList.remove(
                "menu-open"
            );

        }


        if (menuButton) {

            menuButton.addEventListener(
                "click",
                () => {

                    const isExpanded =
                        menuButton.getAttribute(
                            "aria-expanded"
                        ) === "true";


                    menuButton.setAttribute(
                        "aria-expanded",
                        String(!isExpanded)
                    );


                    document.body.classList.toggle(
                        "menu-open",
                        !isExpanded
                    );

                }
            );

        }


        /* =================================================
           BRAND CLICK
        ================================================== */

        if (brand) {

            brand.addEventListener(
                "click",
                () => {

                    closeMobileMenu();

                }
            );

        }


        /* =================================================
           MOBILE NAV LINKS
        ================================================== */

        const mobileLinks =
            document.querySelectorAll(
                ".mobile-nav a"
            );


        mobileLinks.forEach(
            (link) => {

                link.addEventListener(
                    "click",
                    () => {

                        closeMobileMenu();

                    }
                );

            }
        );


        /* =================================================
           INTERNAL ANCHOR LINKS
        ================================================== */

        const internalLinks =
            document.querySelectorAll(
                'a[href^="#"]'
            );


        internalLinks.forEach(
            (link) => {

                link.addEventListener(
                    "click",
                    (event) => {

                        const targetId =
                            link.getAttribute(
                                "href"
                            );


                        if (
                            !targetId ||
                            targetId === "#"
                        ) {

                            return;

                        }


                        const target =
                            document.querySelector(
                                targetId
                            );


                        if (!target) {

                            return;

                        }


                        event.preventDefault();


                        target.scrollIntoView(
                            {
                                behavior: "smooth",
                                block: "start"
                            }
                        );


                        closeMobileMenu();

                    }
                );

            }
        );


        /* =================================================
           LOGIN DROPDOWN
        ================================================== */

        const loginDropdown =
            document.querySelector(
                ".login-dropdown"
            );


        const loginButton =
            document.querySelector(
                ".login-button"
            );


        if (
            loginDropdown &&
            loginButton
        ) {

            loginButton.addEventListener(
                "click",
                (event) => {

                    event.stopPropagation();


                    const isOpen =
                        loginButton.getAttribute(
                            "aria-expanded"
                        ) === "true";


                    loginButton.setAttribute(
                        "aria-expanded",
                        String(!isOpen)
                    );


                    loginDropdown.classList.toggle(
                        "login-open",
                        !isOpen
                    );

                }
            );


            document.addEventListener(
                "click",
                () => {

                    loginButton.setAttribute(
                        "aria-expanded",
                        "false"
                    );


                    loginDropdown.classList.remove(
                        "login-open"
                    );

                }
            );


            const loginMenu =
                loginDropdown.querySelector(
                    ".login-menu"
                );


            if (loginMenu) {

                loginMenu.addEventListener(
                    "click",
                    (event) => {

                        event.stopPropagation();

                    }
                );

            }

        }


        /* =================================================
           LANGUAGE SWITCHER
           ==================================================
           
           Translation system will be connected after
           the English version is visually finalized.
        ================================================== */

        const languageButtons =
            document.querySelectorAll(
                ".language-btn"
            );


        languageButtons.forEach(
            (button) => {

                button.addEventListener(
                    "click",
                    () => {

                        languageButtons.forEach(
                            (btn) => {

                                btn.classList.remove(
                                    "active"
                                );

                            }
                        );


                        button.classList.add(
                            "active"
                        );


                        const selectedLanguage =
                            button.dataset.lang;


                        document.documentElement
                            .setAttribute(
                                "lang",
                                selectedLanguage === "mr"
                                    ? "mr"
                                    : "en"
                            );


                        console.log(
                            "SIR language selected:",
                            selectedLanguage
                        );

                    }
                );

            }
        );


        /* =================================================
           ESCAPE KEY
        ================================================== */

        document.addEventListener(
            "keydown",
            (event) => {

                if (
                    event.key === "Escape"
                ) {

                    closeMobileMenu();


                    if (loginButton) {

                        loginButton.setAttribute(
                            "aria-expanded",
                            "false"
                        );

                    }


                    if (loginDropdown) {

                        loginDropdown.classList.remove(
                            "login-open"
                        );

                    }

                }

            }
        );


        /* =================================================
           HERO IMAGE ERROR CHECK
        ================================================== */

        const heroImages =
            document.querySelectorAll(
                ".hero-media img"
            );


        heroImages.forEach(
            (image) => {

                image.addEventListener(
                    "error",
                    () => {

                        console.warn(
                            "SIR hero image could not be loaded:",
                            image.src
                        );

                    }
                );

            }
        );


        /* =================================================
           FALLBACK
           Make content visible even if observer behaves
           differently on a browser/device.
        ================================================== */

        setTimeout(
            () => {

                document
                    .querySelectorAll(
                        ".story-section"
                    )
                    .forEach(
                        (section) => {

                            section.classList.add(
                                "is-visible"
                            );

                        }
                    );


                const finalSection =
                    document.querySelector(
                        ".final-section"
                    );


                if (finalSection) {

                    finalSection.classList.add(
                        "is-visible"
                    );

                }

            },
            700
        );


        console.log(
            "SIR website loaded successfully."
        );
       /* =========================================================
   SIR — HOMEPAGE NOTICE SYSTEM
========================================================= */

async function loadHomepageNotices() {

    const bulletinSection =
        document.querySelector(".sir-bulletin-section");

    if (!bulletinSection) return;

    const grid =
        bulletinSection.querySelector(".bulletin-grid");

    if (!grid) return;

    try {

        const { data, error } =
            await supabaseClient
                .from("notices")
                .select("*")
                .eq("is_published", true)
                .order("published_at", {
                    ascending: false
                })
                .limit(4);

        if (error) {

            console.error(
                "SIR Notice System:",
                error
            );

            return;
        }

        if (!data || data.length === 0) {
            return;
        }

        grid.innerHTML = data.map(
            (notice, index) => {

                const category =
                    escapeNoticeHTML(
                        String(
                            notice.category || "GENERAL"
                        ).toUpperCase()
                    );

                const title =
                    escapeNoticeHTML(
                        notice.title || "SIR Notice"
                    );

                const description =
                    escapeNoticeHTML(
                        notice.description || ""
                    );

                const date =
                    notice.published_at
                        ? formatNoticeDate(
                            notice.published_at
                        )
                        : "";

                return `
                    <article class="bulletin-card${index === 0 ? " bulletin-featured" : ""}">

                        <div class="bulletin-top">

                            <span class="bulletin-category">
                                ${category}
                            </span>

                            ${
                                date
                                    ? `<span class="bulletin-date">${date}</span>`
                                    : ""
                            }

                        </div>

                        <h3>${title}</h3>

                        <p>${description}</p>

                        <a href="notice-board.html">
                            VIEW NOTICE →
                        </a>

                    </article>
                `;

            }
        ).join("");

    } catch (error) {

        console.error(
            "SIR Notice System Error:",
            error
        );

    }

}


function formatNoticeDate(dateValue) {

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleDateString(
        "en-IN",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    ).toUpperCase();

}


function escapeNoticeHTML(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


/* =========================================================
   LOAD NOTICES WHEN HOMEPAGE LOADS
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        loadHomepageNotices();

    }
);

    }
);
