"use strict";

(() => {
    const root = document.documentElement;
    root.classList.add("js-ok"); // switches off the CSS failsafe

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    const hasWebGL = (() => {
        try {
            const c = document.createElement("canvas");
            return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
        } catch {
            return false;
        }
    })();
    if (!hasWebGL) root.classList.add("no-webgl");

    // Shared with scene.js (the WebGL form)
    const flow = (window.flow = {
        disabled: !hasWebGL,
        reduceMotion,
        story: 0, // float chapter index: 0 = hero, 1 = about, ...
        pointer: { x: 0, y: 0, active: false },
        ready: false,
        onReady() {
            flow.ready = true;
        },
    });

    /* ---------- Intro ---------- */
    let started = false;
    const start = () => {
        if (started) return;
        started = true;
        root.classList.add("is-ready");
        runCounters();
    };
    // Wait for fonts (and briefly for the scene) so the intro plays in one go
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1200))]).then(() => {
        const t0 = performance.now();
        const wait = () => (flow.ready || flow.disabled || performance.now() - t0 > 900 ? start() : requestAnimationFrame(wait));
        wait();
    });
    setTimeout(start, 3000);

    /* ---------- Smooth wheel scroll ---------- */
    const smooth = { target: window.scrollY, current: window.scrollY, running: false };
    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

    function smoothLoop() {
        smooth.current += (smooth.target - smooth.current) * 0.1;
        if (Math.abs(smooth.target - smooth.current) < 0.5) {
            smooth.current = smooth.target;
            smooth.running = false;
        }
        window.scrollTo(0, smooth.current);
        if (smooth.running) requestAnimationFrame(smoothLoop);
    }

    function scrollToY(y) {
        if (reduceMotion) {
            window.scrollTo(0, y);
            return;
        }
        smooth.target = clamp(y, 0, maxScroll());
        if (!smooth.running) {
            smooth.current = window.scrollY;
            smooth.running = true;
            requestAnimationFrame(smoothLoop);
        }
    }

    if (!reduceMotion) {
        window.addEventListener(
            "wheel",
            (event) => {
                if (event.ctrlKey || event.defaultPrevented) return;
                event.preventDefault();
                const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * window.innerHeight : event.deltaY;
                if (!smooth.running) smooth.target = window.scrollY;
                scrollToY(smooth.target + delta);
            },
            { passive: false }
        );
    }

    // Keyboard, scrollbar and touch scrolling keep the target in sync
    window.addEventListener(
        "scroll",
        () => {
            if (!smooth.running) smooth.target = smooth.current = window.scrollY;
        },
        { passive: true }
    );

    /* ---------- Mobile navigation ---------- */
    const navToggle = document.querySelector("[data-nav-toggle]");
    const navMenu = document.querySelector("[data-nav-menu]");
    const setNavOpen = (open) => {
        navToggle.setAttribute("aria-expanded", String(open));
        navMenu.classList.toggle("is-open", open);
    };
    navToggle.addEventListener("click", () => setNavOpen(navToggle.getAttribute("aria-expanded") !== "true"));
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") setNavOpen(false);
    });

    /* ---------- In-page links glide (and move focus) ---------- */
    document.addEventListener("click", (event) => {
        const link = event.target.closest('a[href^="#"]');
        if (!link) return;
        const id = link.getAttribute("href");
        const target = document.querySelector(id);
        if (!target) return;
        event.preventDefault();
        setNavOpen(false);
        const y = id === "#top" ? 0 : target.getBoundingClientRect().top + window.scrollY - (id === "#contact" ? 0 : 70);
        scrollToY(y);
        history.replaceState(null, "", id);
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
    });

    /* ---------- Active nav link ---------- */
    const navLinks = [...document.querySelectorAll("[data-nav-link]")];
    const navObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                navLinks.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === `#${entry.target.id}`));
            });
        },
        { rootMargin: "-45% 0px -50% 0px" }
    );
    navLinks.map((l) => document.querySelector(l.getAttribute("href"))).filter(Boolean).forEach((s) => navObserver.observe(s));

    /* ---------- Reveals ---------- */
    const revealObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                revealObserver.unobserve(entry.target);
            });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    document.querySelectorAll(".reveal, .reveal-lines").forEach((el) => {
        const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
        const index = siblings.indexOf(el);
        if (index > 0) el.style.setProperty("--delay", `${Math.min(index * 0.08, 0.4)}s`);
        revealObserver.observe(el);
    });

    /* ---------- Statement: words light up with scroll ---------- */
    const statement = document.querySelector("#approach");
    const wordsEl = document.querySelector("[data-words]");
    const keyWords = new Set(["data,", "state", "predictable,", "consistent", "quick"]);
    let words = [];
    if (wordsEl) {
        const text = wordsEl.textContent.trim().split(/\s+/);
        wordsEl.setAttribute("aria-label", text.join(" "));
        wordsEl.textContent = "";
        text.forEach((word, i) => {
            const span = document.createElement("span");
            span.className = keyWords.has(word) ? "w is-key" : "w";
            span.textContent = word;
            span.setAttribute("aria-hidden", "true");
            wordsEl.append(span);
            if (i < text.length - 1) wordsEl.append(" ");
        });
        words = [...wordsEl.querySelectorAll(".w")];
    }

    /* ---------- Scroll-driven state: header, story, rail, words ---------- */
    const header = document.querySelector("[data-header]");
    const chapters = [...document.querySelectorAll("[data-chapter]")];
    const rail = document.querySelector("[data-rail]");
    const railNum = document.querySelector("[data-rail-num]");
    const railName = document.querySelector("[data-rail-name]");
    const railFill = document.querySelector("[data-rail-fill]");
    let currentChapter = -1;
    let queued = false;

    function update() {
        queued = false;
        const y = window.scrollY;
        const vh = window.innerHeight || 1;
        const mid = y + vh * 0.5;

        header.classList.toggle("is-scrolled", y > 12);

        // Float chapter index from section centers (the form glides between keyframes)
        const centers = chapters.map((el) => {
            const r = el.getBoundingClientRect();
            const top = r.top + y;
            // Tall sticky sections count from their middle third
            return top + Math.min(r.height, vh * 1.2) * 0.5;
        });
        let story = 0;
        if (mid <= centers[0]) story = 0;
        else if (mid >= centers[centers.length - 1]) story = centers.length - 1;
        else {
            for (let i = 0; i < centers.length - 1; i++) {
                if (mid < centers[i + 1]) {
                    story = i + (mid - centers[i]) / Math.max(1, centers[i + 1] - centers[i]);
                    break;
                }
            }
        }
        flow.story = story;

        // Chapter rail
        const idx = clamp(Math.round(story), 0, chapters.length - 1);
        if (idx !== currentChapter) {
            currentChapter = idx;
            railNum.textContent = chapters[idx].dataset.chapter;
            railName.textContent = chapters[idx].dataset.chapterName;
        }
        rail.classList.toggle("is-on", y > vh * 0.5);
        railFill.style.transform = `scaleY(${clamp(y / Math.max(1, maxScroll()), 0, 1)})`;

        // Statement words
        if (statement && words.length && !reduceMotion) {
            const r = statement.getBoundingClientRect();
            const p = clamp((-r.top + vh * 0.15) / Math.max(1, r.height - vh * 0.9), 0, 1);
            const lit = Math.round(p * words.length * 1.1);
            words.forEach((w, i) => w.classList.toggle("is-lit", i < lit));
        }
    }

    const queue = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(update);
    };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    update();

    /* ---------- Pointer -> scene ---------- */
    window.addEventListener("pointermove", (e) => {
        flow.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        flow.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
        flow.pointer.active = true;
    });
    document.addEventListener("pointerleave", () => (flow.pointer.active = false));

    /* ---------- Cursor light on cards ---------- */
    document.querySelectorAll(".card").forEach((card) => {
        card.addEventListener("pointermove", (e) => {
            const r = card.getBoundingClientRect();
            card.style.setProperty("--mx", `${e.clientX - r.left}px`);
            card.style.setProperty("--my", `${e.clientY - r.top}px`);
        });
    });

    /* ---------- Magnetic buttons ---------- */
    if (finePointer && !reduceMotion) {
        document.querySelectorAll("[data-magnetic]").forEach((el) => {
            el.addEventListener("pointermove", (e) => {
                const r = el.getBoundingClientRect();
                const dx = e.clientX - (r.left + r.width / 2);
                const dy = e.clientY - (r.top + r.height / 2);
                el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.3}px)`;
            });
            el.addEventListener("pointerleave", () => (el.style.transform = ""));
        });
    }

    /* ---------- Counters ---------- */
    function runCounters() {
        document.querySelectorAll("[data-count]").forEach((el) => {
            const end = Number(el.dataset.count);
            if (reduceMotion) return;
            const t0 = performance.now() + 500;
            const tick = (now) => {
                const t = clamp((now - t0) / 1400, 0, 1);
                el.textContent = String(Math.round(end * (1 - Math.pow(1 - t, 3))));
                if (t < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

    /* ---------- Copy email ---------- */
    document.querySelectorAll("[data-copy]").forEach((button) => {
        const label = button.querySelector("[data-copy-label]");
        const original = label.textContent;
        button.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(button.dataset.copy);
                label.textContent = "Copied!";
            } catch {
                window.location.href = `mailto:${button.dataset.copy}`;
                return;
            }
            setTimeout(() => (label.textContent = original), 1800);
        });
    });

    /* ---------- Footer year ---------- */
    const year = String(new Date().getFullYear());
    document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = year));
})();
