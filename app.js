/* =========================================================
   SIR — STORY EXPERIENCE
========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    const sections = document.querySelectorAll(".story-section");
    const menuButton = document.querySelector(".menu-toggle");

    /* ---------------------------------------------
       STORY REVEAL
    --------------------------------------------- */

    const revealObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-visible");
                }
            });
        },
        {
            threshold: 0.2
        }
    );

    sections.forEach((section) => {
        revealObserver.observe(section);
    });


    /* ---------------------------------------------
       ACTIVE STORY CHAPTER
    --------------------------------------------- */

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


    /* ---------------------------------------------
       MENU BUTTON
    --------------------------------------------- */

    if (menuButton) {

        menuButton.addEventListener("click", () => {

            const expanded =
                menuButton.getAttribute("aria-expanded") === "true";

            menuButton.setAttribute(
                "aria-expanded",
                String(!expanded)
            );

            document.body.classList.toggle("menu-open");
        });

    }


    /* ---------------------------------------------
       IMAGE LOAD SAFETY
    --------------------------------------------- */

    const heroImages = document.querySelectorAll(
        ".hero-media img"
    );

    heroImages.forEach((image) => {

        image.addEventListener("error", () => {
            image.style.display = "none";
        });

    });

});
