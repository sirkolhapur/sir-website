// ==========================================
// SIR — SUPABASE CONFIGURATION
// ==========================================

const SUPABASE_URL =
  "https://asbyosqpupqspzvqqhfj.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_5kLRY64Pv5Ct-ZXuNtgEAw_51YUDqyw";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

console.log("SIR Supabase connected.");
// ==========================================
// SIR — SUPABASE CONFIGURATION
// ==========================================

const SUPABASE_URL = "https://asbyosqpupqspzvqqhfj.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_5kLRY64Pv5Ct-ZXuNtgEAw_51YUDqyw";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

console.log("SIR Supabase connected.");

/* =========================================================
   SIR — WEBSITE INTERACTION
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    /* =====================================================
       01. SELECT ELEMENTS
    ===================================================== */

    const sections = document.querySelectorAll(".story-section");
    const menuButton = document.querySelector(".menu-toggle");
    const brand = document.querySelector(".brand");


    /* =====================================================
       02. STORY REVEAL
    ===================================================== */

    const revealObserver = new IntersectionObserver(
        (entries) => {

            entries.forEach((entry) => {

                if (entry.isIntersecting) {
                    entry.target.classList.add("is-visible");
                }

            });

        },
        {
            threshold: 0.18
        }
    );


    sections.forEach((section) => {
        revealObserver.observe(section);
    });


    /* =====================================================
       03. ACTIVE STORY CHAPTER
    ===================================================== */

    const chapterObserver = new IntersectionObserver(
        (entries) => {

            entries.forEach((entry) => {

                if (entry.isIntersecting) {

                    sections.forEach((section) => {
                        section.classList.remove("active-story");
                    });

                    entry.target.classList.add("active-story");

                }

            });

        },
        {
            threshold: 0.55
        }
    );


    sections.forEach((section) => {
        chapterObserver.observe(section);
    });


    /* =====================================================
       04. MOBILE MENU STATE
    ===================================================== */

    if (menuButton) {

        menuButton.addEventListener("click", () => {

            const isExpanded =
                menuButton.getAttribute("aria-expanded") === "true";

            menuButton.setAttribute(
                "aria-expanded",
                String(!isExpanded)
            );

            document.body.classList.toggle(
                "menu-open",
                !isExpanded
            );

        });

    }


    /* =====================================================
       05. CLOSE MENU WHEN HOME IS CLICKED
    ===================================================== */

    if (brand) {

        brand.addEventListener("click", () => {

            if (menuButton) {

                menuButton.setAttribute(
                    "aria-expanded",
                    "false"
                );

            }

            document.body.classList.remove("menu-open");

        });

    }


    /* =====================================================
       06. SMOOTH INTERNAL LINKS
    ===================================================== */

    const internalLinks =
        document.querySelectorAll('a[href^="#"]');


    internalLinks.forEach((link) => {

        link.addEventListener("click", (event) => {

            const targetId =
                link.getAttribute("href");

            if (
                !targetId ||
                targetId === "#"
            ) {
                return;
            }

            const target =
                document.querySelector(targetId);

            if (!target) {
                return;
            }

            event.preventDefault();

            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });


            /* Close mobile menu */

            if (menuButton) {

                menuButton.setAttribute(
                    "aria-expanded",
                    "false"
                );

            }

            document.body.classList.remove(
                "menu-open"
            );

        });

    });


    /* =====================================================
       07. HERO IMAGE FALLBACK
    ===================================================== */

    const heroImages =
        document.querySelectorAll(".hero-media img");


    heroImages.forEach((image) => {

        image.addEventListener("error", () => {

            console.warn(
                "SIR hero image could not be loaded:",
                image.src
            );

        });

    });


    /* =====================================================
       08. KEYBOARD ACCESSIBILITY
    ===================================================== */

    document.addEventListener("keydown", (event) => {

        if (event.key === "Escape") {

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

    });


    /* =====================================================
       09. INITIAL HERO STATE
    ===================================================== */

    const hero =
        document.querySelector(".hero");

    if (hero) {

        setTimeout(() => {
            hero.classList.add("is-visible");
        }, 120);

    }

});
