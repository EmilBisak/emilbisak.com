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

    // Shared with scene.js (the WebGL ribbon)
    const flow = (window.flow = {
        disabled: !hasWebGL,
        reduceMotion,
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

    // One step per frame. The WebGL ribbon calls this before it draws, so the
    // page and the ribbon always move together in the same frame.
    let lastStep = -1;
    let ease = 0.0063; // per ms: a mouse wheel glides, a trackpad (already smooth) follows closely
    function stepScroll(now) {
        if (!smooth.running || now === lastStep) return;
        const dt = lastStep < 0 ? 16.7 : Math.min(now - lastStep, 100);
        lastStep = now;
        smooth.current += (smooth.target - smooth.current) * (1 - Math.exp(-dt * ease));
        if (Math.abs(smooth.target - smooth.current) < 0.5) {
            smooth.current = smooth.target;
            smooth.running = false;
        }
        window.scrollTo(0, smooth.current);
    }

    function smoothLoop(now) {
        stepScroll(now);
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
            lastStep = -1;
            requestAnimationFrame(smoothLoop);
        }
    }
    flow.stepScroll = stepScroll;

    if (!reduceMotion) {
        window.addEventListener(
            "wheel",
            (event) => {
                if (event.ctrlKey || event.defaultPrevented) return;
                event.preventDefault();
                if (navMenu.classList.contains("is-open")) return; // the page stays put under an open menu
                // Trackpads send many small deltas; a wheel notch is a big step
                const trackpad = event.deltaMode === 0 && Math.abs(event.deltaY) < 50;
                ease = trackpad ? 0.025 : 0.0063;
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
        root.classList.toggle("nav-open", open); // locks page scrolling under the menu
    };
    const isNavOpen = () => navMenu.classList.contains("is-open");
    navToggle.addEventListener("click", () => setNavOpen(!isNavOpen()));
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !isNavOpen()) return;
        setNavOpen(false);
        navToggle.focus();
    });
    // A tap or click anywhere outside the menu closes it
    document.addEventListener("pointerdown", (e) => {
        if (isNavOpen() && !navMenu.contains(e.target) && !navToggle.contains(e.target)) setNavOpen(false);
    });
    window.matchMedia("(min-width: 901px)").addEventListener("change", (e) => e.matches && setNavOpen(false));

    /* ---------- In-page links glide (and move focus) ---------- */
    // Page position from layout alone (offsetTop ignores the reveal transforms)
    const docTop = (el) => {
        let y = 0;
        for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
        return y;
    };
    // Where a section should land after a jump. Sections with a heading block are aimed at
    // their heading, so the title ends up at the same spot on screen even when the heading
    // sits lower in its section (Work centers it next to the code card).
    const jumpTarget = (id, target) => {
        if (id === "#top") return 0;
        if (id === "#contact") return docTop(target);
        const label = target.querySelector(".section-head .chapter");
        if (!label) return docTop(target) - 70;
        const pad = parseFloat(getComputedStyle(target).paddingTop) || 0;
        return docTop(label) - pad - 70;
    };
    document.addEventListener("click", (event) => {
        const link = event.target.closest('a[href^="#"]');
        if (!link) return;
        const id = link.getAttribute("href");
        const target = document.querySelector(id);
        if (!target) return;
        event.preventDefault();
        setNavOpen(false);
        const y = jumpTarget(id, target);
        ease = 0.0063;
        scrollToY(y);
        history.replaceState(null, "", id);
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
    });

    /* ---------- Active nav link (from the scroll position, see update) ---------- */
    const navLinks = [...document.querySelectorAll("[data-nav-link]")];
    let activeId = "";
    function setActiveNav(id) {
        if (id === activeId) return;
        activeId = id;
        navLinks.forEach((l) => {
            const on = l.getAttribute("href") === `#${id}`;
            l.classList.toggle("is-active", on);
            if (on) l.setAttribute("aria-current", "true");
            else l.removeAttribute("aria-current");
        });
    }

    /* ---------- Reveals (checked on every scroll frame, see update) ---------- */
    // A plain position check instead of an observer: content can never be left hidden after
    // a jump, and it shows the moment it enters the screen
    let pending = [...document.querySelectorAll(".reveal")];
    pending.forEach((el) => {
        const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
        const index = siblings.indexOf(el);
        if (index > 0) el.style.setProperty("--delay", `${Math.min(index * 0.06, 0.24)}s`);
    });
    function revealInView(vh) {
        if (!pending.length) return;
        pending = pending.filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.top < vh * 0.92 && r.bottom > 0) {
                el.classList.add("is-visible");
                return false;
            }
            return true;
        });
    }

    /* ---------- Card edges light up near the cursor ---------- */
    const cards = finePointer ? [...document.querySelectorAll(".card")] : [];
    const cursor = { x: -9999, y: -9999 };
    let cardsQueued = false;
    function lightCards() {
        cardsQueued = false;
        // Read every rect first, then write, so the browser lays out only once
        const rects = cards.map((card) => card.getBoundingClientRect());
        cards.forEach((card, i) => {
            const r = rects[i];
            if (r.bottom < -300 || r.top > window.innerHeight + 300) return;
            card.style.setProperty("--mx", `${cursor.x - r.left}px`);
            card.style.setProperty("--my", `${cursor.y - r.top}px`);
        });
    }
    function queueCards() {
        if (cardsQueued || !cards.length) return;
        cardsQueued = true;
        requestAnimationFrame(lightCards);
    }
    if (cards.length) {
        window.addEventListener("pointermove", (e) => {
            if (e.pointerType === "touch") return;
            cursor.x = e.clientX;
            cursor.y = e.clientY;
            queueCards();
        });
        document.addEventListener("pointerleave", () => {
            cursor.x = cursor.y = -9999;
            queueCards();
        });
    }

    /* ---------- Scroll-driven state: header, nav, chapter rail ---------- */
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

        header.classList.toggle("is-scrolled", y > 12);
        revealInView(vh);

        // Current chapter: the last section whose top has passed 40% of the screen
        // (the last one once the page bottom is reached). Nav and chapter rail share it.
        let idx = 0;
        chapters.forEach((el, i) => {
            if (el.getBoundingClientRect().top <= vh * 0.4) idx = i;
        });
        if (y + vh >= document.documentElement.scrollHeight - 2) idx = chapters.length - 1;
        setActiveNav(chapters[idx].id);

        // Chapter rail
        if (idx !== currentChapter) {
            currentChapter = idx;
            railNum.textContent = chapters[idx].dataset.chapter;
            railName.textContent = chapters[idx].dataset.chapterName;
        }
        rail.classList.toggle("is-on", y > vh * 0.5);
        railFill.style.transform = `scaleY(${clamp(y / Math.max(1, maxScroll()), 0, 1)})`;

        queueCards();
    }

    const queue = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(update);
    };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    window.addEventListener("load", queue); // fonts and images can shift sections into view
    update();

    /* ---------- Pointer -> scene ---------- */
    window.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch") return; // a finger dragging the page is not a hover
        flow.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        flow.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
        flow.pointer.active = true;
    });
    document.addEventListener("pointerleave", () => (flow.pointer.active = false));

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

    /* ---------- Code card: typed out behind the caret ---------- */
    const codeCard = document.querySelector(".code-visual");
    if (codeCard && !reduceMotion && "IntersectionObserver" in window) {
        const code = codeCard.querySelector("code");
        const caret = code.querySelector(".caret");
        const chars = [];
        // Wrap each character in its own span, remembering its line and whether it is indentation
        let line = 0;
        let atLineStart = true;
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        texts.forEach((node) => {
            const frag = document.createDocumentFragment();
            for (const ch of node.textContent) {
                if (ch === "\n") {
                    frag.append(ch);
                    line++;
                    atLineStart = true;
                    continue;
                }
                const span = document.createElement("span");
                span.className = "ch";
                span.textContent = ch;
                frag.append(span);
                chars.push({ el: span, line, indent: atLineStart && ch === " " });
                if (ch !== " ") atLineStart = false;
            }
            node.replaceWith(frag);
        });
        code.prepend(caret);
        codeCard.classList.add("is-typing");

        let i = 0;
        const typeNext = () => {
            // A line's indentation appears at once together with its first character,
            // as if the editor added it
            let ch;
            do {
                ch = chars[i++];
                ch.el.classList.add("on");
                ch.el.after(caret);
            } while (ch.indent && i < chars.length && chars[i].line === ch.line);
            if (i >= chars.length) {
                codeCard.classList.remove("is-typing");
                return;
            }
            const lineEnd = chars[i].line !== ch.line;
            setTimeout(typeNext, lineEnd ? 100 + Math.random() * 80 : 12 + Math.random() * 24);
        };
        const typeObserver = new IntersectionObserver(
            (entries) => {
                if (!entries.some((e) => e.isIntersecting)) return;
                typeObserver.disconnect();
                setTimeout(typeNext, 450);
            },
            { threshold: 0.4 }
        );
        typeObserver.observe(codeCard);
    }

    /* ---------- Code card: sways in 3D after the cursor ---------- */
    // The card rests flat (style.css) and leans toward the cursor wherever it is on screen,
    // eased so it drifts instead of snapping. Scrolling moves the card under a still cursor,
    // so it rocks gently then too. --tx / --ty run from -1 to 1.
    if (codeCard && finePointer && !reduceMotion && "IntersectionObserver" in window) {
        const lean = { x: 0, y: 0 };
        let swaying = false;
        let lastT = 0;
        const sway = (t) => {
            if (!swaying) return;
            requestAnimationFrame(sway);
            const dt = Math.min((t - (lastT || t)) / 1000, 0.05);
            lastT = t;
            let tx = 0;
            let ty = 0;
            const p = flow.pointer;
            if (p.active) {
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const r = codeCard.getBoundingClientRect();
                tx = clamp((((p.x + 1) / 2) * vw - (r.left + r.width / 2)) / (vw / 2), -1, 1);
                ty = clamp((((1 - p.y) / 2) * vh - (r.top + r.height / 2)) / (vh / 2), -1, 1);
            }
            const k = 1 - Math.exp(-dt * 3.5);
            const nx = lean.x + (tx - lean.x) * k;
            const ny = lean.y + (ty - lean.y) * k;
            // Skip style writes once it has settled
            if (Math.abs(nx - lean.x) + Math.abs(ny - lean.y) < 0.0004) return;
            lean.x = nx;
            lean.y = ny;
            codeCard.style.setProperty("--tx", nx.toFixed(4));
            codeCard.style.setProperty("--ty", ny.toFixed(4));
        };
        new IntersectionObserver((entries) => {
            const inView = entries.some((e) => e.isIntersecting);
            if (inView && !swaying) {
                swaying = true;
                lastT = 0;
                requestAnimationFrame(sway);
            } else if (!inView) {
                swaying = false;
            }
        }).observe(codeCard);
    }

    /* ---------- Portrait: fades into color on touch screens ---------- */
    // With a mouse the photo turns color on hover (style.css). Touch screens have no hover, so
    // there it fades into color once it is half on screen, and turns black and white again
    // after it has left the screen, so the effect plays again next time.
    const photoFrame = document.querySelector(".photo-frame");
    if (photoFrame && !finePointer && "IntersectionObserver" in window) {
        new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (e.intersectionRatio >= 0.5) photoFrame.classList.add("in-color");
                    else if (!e.isIntersecting) photoFrame.classList.remove("in-color");
                });
            },
            { threshold: [0, 0.5] }
        ).observe(photoFrame);
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
