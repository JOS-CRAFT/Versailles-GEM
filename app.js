        /* ============================================================
           Configuration Supabase
           (la clé "publishable" est faite pour être publique : la sécurité
           repose sur les règles RLS définies dans les scripts SQL)
           ============================================================ */
        const SUPABASE_URL = "https://jrnjlgfhbbsduvocxbzo.supabase.co";
        const SUPABASE_KEY = "sb_publishable_b6nnnOAifjLIiFE3qtmAWA_M6Fx4kCN";

        const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

        /* ============================================================
           Carte
           ============================================================ */
        const map = L.map('map', { zoomControl: false, maxZoom: 22 }).setView([48.80475, 2.12035], 16);
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        L.tileLayer(
            'https://api.maptiler.com/maps/hybrid-v4/{z}/{x}/{y}.jpg?key=LzAVsidIazDKuquLRVH8',
            {
                attribution: '©MapTiler ©OpenStreetMap',
                maxNativeZoom: 19,   // niveau de détail max fourni par les tuiles
                maxZoom: 22          // au-delà, les tuiles sont simplement agrandies
            }
        ).addTo(map);

        /* ============================================================
           Marqueurs
           - la FORME      = la catégorie (6 formes = 6 catégories max)
           - la COULEUR    = le type d'enceinte (+ son code écrit dedans)
           - le "✓ vert"   = point récupéré (marqueur estompé)
           - contour en pointillés = point sans catégorie
           ============================================================ */
        const SHAPES = {
            circle:   '<circle cx="20" cy="20" r="13"/>',
            square:   '<rect x="7" y="7" width="26" height="26" rx="4"/>',
            diamond:  '<polygon points="20,4 36,20 20,36 4,20"/>',
            triangle: '<polygon points="20,6 35,33 5,33"/>',
            hexagon:  '<polygon points="20,5 33,12.5 33,27.5 20,35 7,27.5 7,12.5"/>',
            octagon:  '<polygon points="14,6 26,6 34,14 34,26 26,34 14,34 6,26 6,14"/>'
        };

        const SHAPE_NAMES = {
            circle: "Cercle", square: "Carré", diamond: "Losange",
            triangle: "Triangle", hexagon: "Hexagone", octagon: "Octogone"
        };

        const SHAPE_KEYS = Object.keys(SHAPES);
        const MAX_CATEGORIES = SHAPE_KEYS.length;

        const NEUTRAL_FILL = "#94a3b8";

        function shapeSvg({
            shape = "circle", fill = NEUTRAL_FILL, stroke = "white", label = "", size = 38,
            outline = false, recovered = false, dashed = false, shadow = false
        }) {
            const body = SHAPES[shape] || SHAPES.circle;
            const textY = shape === "triangle" ? 30 : 24.5;
            const fontSize = label.length >= 3 ? 10 : 12;
            const showText = label && size >= 30;

            const text = showText ? `
                <text x="20" y="${textY}" text-anchor="middle" opacity="${recovered ? .75 : 1}"
                      font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700"
                      fill="white" stroke="rgba(0,0,0,.65)" stroke-width="2.5"
                      paint-order="stroke" stroke-linejoin="round">${escapeHtml(label)}</text>` : "";

            const halo = outline
                ? `<g fill="none" stroke="#2980b9" stroke-width="10" stroke-linejoin="round">${body}</g>`
                : "";

            const dash = dashed ? ' stroke-dasharray="5 3.5"' : "";

            const badge = recovered ? `
                <g transform="translate(32 8)">
                    <circle r="8" fill="#27ae60" stroke="white" stroke-width="2"/>
                    <path d="M-3.6 0.2 L-1 3 L3.8 -2.8" fill="none" stroke="white" stroke-width="2.2"
                          stroke-linecap="round" stroke-linejoin="round"/>
                </g>` : "";

            const style = "overflow:visible;display:block" +
                (shadow ? ";filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))" : "");

            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 44 44" width="${size}" height="${size}" style="${style}">
                        ${halo}
                        <g fill="${fill}" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"${dash}
                           opacity="${recovered ? .55 : 1}">${body}</g>
                        ${text}
                        ${badge}
                    </svg>`;
        }

        // Icône complète d'un point (forme = catégorie, couleur = type d'enceinte)
        function siteIconSvg(site, size = 38, { outline = false, shadow = false } = {}) {
            const type = getSpeakerType(site);
            const cat = getCategory(site);

            return shapeSvg({
                shape: cat ? cat.shape : "circle",
                dashed: !cat,
                fill: type ? type.color : NEUTRAL_FILL,
                stroke: "white",
                label: type ? type.label : "",
                size,
                outline,
                shadow,
                recovered: !!site.recovered
            });
        }

        // Aperçu neutre d'une catégorie (sa forme), pour les listes et filtres
        const catPreview = (cat, size = 24) => shapeSvg({
            shape: cat ? cat.shape : "circle",
            dashed: !cat,
            fill: "#cbd5e1",
            stroke: "#475569",
            size
        });

        // Pastille ronde d'un type d'enceinte (sa couleur + son code si assez grande)
        const typeBadge = (type, size = 26) => shapeSvg({
            shape: "circle",
            fill: type ? type.color : NEUTRAL_FILL,
            stroke: "white",
            label: type ? type.label : "",
            size,
            shadow: true
        });

        /* ============================================================
           État
           ============================================================ */
        const TYPE_COLORS = ["#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c", "#3498db", "#9b59b6", "#e91e63", "#795548", "#607d8b"];
        const SPEC_SUGGESTIONS = ["Poids", "Dimensions", "Puissance", "Impédance", "SPL max", "Réponse en fréquence", "Dispersion", "Connectique", "Amplification", "Accessoires"];

        let me = null;            // utilisateur connecté (auth)
        let profile = null;       // { id, display_name, is_admin, hidden_categories, hidden_types }
        let locations = [];       // lignes de la table locations
        let categories = [];      // lignes de la table categories
        let speakerTypes = [];    // lignes de la table speaker_types (profils d'enceintes)
        const markers = {};       // id du point -> marqueur Leaflet
        let channel = null;       // canal temps réel
        let editMode = false;
        let placing = false;
        let starting = false;
        let currentUserId = null;
        let page = "map";         // "map" | "gear"
        let gearTypeId = null;    // profil ouvert dans la page Matériel

        const getSite = id => locations.find(l => l.id === id) || null;
        const getCategory = site => categories.find(c => c.id === site.category_id) || null;
        const getSpeakerType = site => speakerTypes.find(t => t.id === site.speaker_type_id) || null;
        const hiddenCats = () => new Set((profile && profile.hidden_categories) || []);
        const hiddenTypes = () => new Set((profile && profile.hidden_types) || []);
        const isAdmin = () => !!(profile && profile.is_admin);
        const randomId = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

        function escapeHtml(str) {
            return String(str ?? "").replace(/[&<>"']/g, c => ({
                "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
            }[c]));
        }

        const multiline = str => escapeHtml(str).replace(/\n/g, "<br>");

        function fmtDate(iso) {
            return new Date(iso).toLocaleString("fr-FR", {
                day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
            });
        }

        // "KARA × 6", "KARA", "× 6" ou ""
        function speakerLine(site) {
            const type = getSpeakerType(site);
            const qty = site.quantity != null ? "× " + site.quantity : "";
            return [type ? type.name : "", qty].filter(Boolean).join(" ");
        }

        const safeUrl = url => /^https?:\/\//i.test(url || "") ? url : "";
        const autoLabel = name => name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

        let toastTimer;
        function toast(message, isError) {
            const el = document.getElementById("toast");
            el.textContent = message;
            el.className = "show" + (isError ? " error" : "");
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { el.className = ""; }, 4200);
        }

        /* ============================================================
           Authentification
           ============================================================ */
        let authMode = "login";

        function setAuthMsg(text, kind) {
            const el = document.getElementById("authMsg");
            el.textContent = text || "";
            el.className = kind || "";
        }

        function setAuthMode(mode, keepMessage) {
            authMode = mode;
            const signup = mode === "signup";

            document.getElementById("tabLogin").classList.toggle("active", !signup);
            document.getElementById("tabSignup").classList.toggle("active", signup);
            document.getElementById("authName").style.display = signup ? "block" : "none";
            document.getElementById("authName").required = signup;
            document.getElementById("authPassword").autocomplete = signup ? "new-password" : "current-password";
            document.getElementById("authSubmit").textContent = signup ? "Créer mon compte" : "Se connecter";
            document.getElementById("forgot").style.display = signup ? "none" : "block";

            if (!keepMessage) setAuthMsg("");
        }

        function translateAuthError(err) {
            const msg = String((err && err.message) || err || "");
            if (/invalid login credentials/i.test(msg)) return "Email ou mot de passe incorrect.";
            if (/already registered/i.test(msg)) return "Un compte existe déjà avec cet email. Connecte-toi.";
            if (/email not confirmed/i.test(msg)) return "Email non confirmé : clique sur le lien reçu par mail.";
            if (/at least 6/i.test(msg)) return "Le mot de passe doit faire au moins 6 caractères.";
            if (/rate limit|too many/i.test(msg)) return "Trop de tentatives, réessaie dans quelques minutes.";
            if (/failed to fetch|network/i.test(msg)) return "Impossible de joindre le serveur (connexion internet ?).";
            if (/invalid email|unable to validate email/i.test(msg)) return "Adresse email invalide.";
            return msg || "Une erreur est survenue.";
        }

        async function submitAuth(e) {
            e.preventDefault();

            const email = document.getElementById("authEmail").value.trim();
            const password = document.getElementById("authPassword").value;
            const name = document.getElementById("authName").value.trim();
            const button = document.getElementById("authSubmit");

            button.disabled = true;
            setAuthMsg("");

            try {
                if (authMode === "login") {
                    const { error } = await sb.auth.signInWithPassword({ email, password });
                    if (error) throw error;
                } else {
                    const { data, error } = await sb.auth.signUp({
                        email,
                        password,
                        options: { data: { display_name: name || email.split("@")[0] } }
                    });
                    if (error) throw error;

                    // Email déjà utilisé (Supabase renvoie alors un utilisateur "vide")
                    if (data.user && data.user.identities && data.user.identities.length === 0) {
                        throw new Error("User already registered");
                    }

                    if (!data.session) {
                        setAuthMode("login", true);
                        setAuthMsg("Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.", "ok");
                    }
                }
            } catch (err) {
                setAuthMsg(translateAuthError(err), "error");
            } finally {
                button.disabled = false;
            }
        }

        async function forgotPassword(e) {
            e.preventDefault();

            const email = document.getElementById("authEmail").value.trim();
            if (!email) {
                setAuthMsg("Saisis ton email puis clique sur « Mot de passe oublié ».", "error");
                return;
            }

            const redirectTo = location.href.split("#")[0].split("?")[0];
            const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });

            if (error) setAuthMsg(translateAuthError(error), "error");
            else setAuthMsg("Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.", "ok");
        }

        async function logout() {
            await sb.auth.signOut();
        }

        function showAuth() {
            document.getElementById("splash").style.display = "none";
            document.getElementById("auth").style.display = "flex";
        }

        function hideAuthAndSplash() {
            document.getElementById("splash").style.display = "none";
            document.getElementById("auth").style.display = "none";
        }

        function showSplash(message, withRetry) {
            document.getElementById("auth").style.display = "none";
            document.getElementById("splash").style.display = "flex";
            document.getElementById("splashMsg").textContent = message;
            document.getElementById("splashRetry").style.display = withRetry ? "flex" : "none";
        }

        /* ============================================================
           Cycle de vie de l'application
           ============================================================ */
        async function handleSession(session) {
            if (!session) {
                stopApp();
                showAuth();
                return;
            }

            if (starting || currentUserId === session.user.id) return;

            currentUserId = session.user.id;
            await startApp(session.user);
        }

        function retryStart() {
            sb.auth.getSession().then(({ data }) => {
                currentUserId = null;
                handleSession(data.session);
            });
        }

        // Vérifie que le script SQL de mise à jour a bien été exécuté
        function checkSchema() {
            const outdated =
                (locations.length && !("comment" in locations[0])) ||
                (categories.length && !("shape" in categories[0])) ||
                (speakerTypes.length && !("color" in speakerTypes[0]));

            if (outdated) {
                const err = new Error("La base de données n'est pas à jour : exécute supabase-update-materiel.sql " +
                    "dans Supabase (SQL Editor), puis clique sur Réessayer.");
                err.isSchema = true;
                throw err;
            }
        }

        async function startApp(user) {
            starting = true;
            showSplash("Chargement des données…", false);

            try {
                me = user;
                await loadData();
                checkSchema();

                const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
                if (error) throw error;

                profile = data || {
                    id: user.id,
                    display_name: (user.user_metadata && user.user_metadata.display_name) || user.email,
                    is_admin: false,
                    hidden_categories: [],
                    hidden_types: []
                };

                profile.hidden_categories = profile.hidden_categories || [];
                profile.hidden_types = profile.hidden_types || [];

                document.body.classList.toggle("admin", profile.is_admin);
                document.getElementById("userName").textContent = profile.display_name;

                rebuildMarkers();
                refreshAll(true);
                subscribe();
                hideAuthAndSplash();
            } catch (err) {
                console.error(err);
                currentUserId = null;

                showSplash(
                    err && err.isSchema
                        ? err.message
                        : "Impossible de charger les données : " + ((err && err.message) || err) +
                          ". Si le projet Supabase est en pause, réactive-le depuis son tableau de bord.",
                    true
                );
            } finally {
                starting = false;
            }
        }

        async function loadData() {
            const [c, t, l] = await Promise.all([
                sb.from("categories").select("*").order("position").order("created_at"),
                sb.from("speaker_types").select("*").order("position").order("created_at"),
                sb.from("locations").select("*").order("created_at")
            ]);

            if (c.error) throw c.error;
            if (t.error) throw t.error;
            if (l.error) throw l.error;

            categories = c.data;
            speakerTypes = t.data;
            locations = l.data;
        }

        function stopApp() {
            if (channel) {
                sb.removeChannel(channel);
                channel = null;
            }

            Object.keys(markers).forEach(id => {
                map.removeLayer(markers[id]);
                delete markers[id];
            });

            map.closePopup();
            closeModal();
            locations = [];
            categories = [];
            speakerTypes = [];
            profile = null;
            me = null;
            currentUserId = null;
            editMode = false;
            placing = false;
            gearTypeId = null;

            document.body.classList.remove("admin", "editing");
            document.getElementById("editToggle").textContent = "✏️ Mode édition";
            document.getElementById("editToggle").classList.remove("active");
            showPage("map");
            setLive(false);
        }

        /* ============================================================
           Temps réel
           ============================================================ */
        function setLive(on) {
            document.getElementById("liveDot").classList.toggle("on", on);
            document.getElementById("liveText").textContent = on ? "En direct" : "Reconnexion…";
        }

        function subscribe() {
            if (channel) sb.removeChannel(channel);

            let wasConnected = false;

            channel = sb.channel("versailles-live")
                .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, payload => {
                    if (payload.eventType === "DELETE") removeLocal(payload.old.id);
                    else upsertLocal(payload.new, true);
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, payload => {
                    if (payload.eventType === "DELETE") removeCategoryLocal(payload.old.id);
                    else upsertCategoryLocal(payload.new);
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "speaker_types" }, payload => {
                    if (payload.eventType === "DELETE") removeSpeakerTypeLocal(payload.old.id);
                    else upsertSpeakerTypeLocal(payload.new);
                })
                .subscribe(status => {
                    if (status === "SUBSCRIBED") {
                        setLive(true);
                        // Après une coupure : on recharge pour récupérer ce qu'on a pu rater
                        if (wasConnected) reloadData();
                        wasConnected = true;
                    } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                        setLive(false);
                    }
                });
        }

        async function reloadData() {
            try {
                await loadData();
                rebuildMarkers();
                refreshAll(false);
            } catch (err) {
                console.error(err);
            }
        }

        /* ============================================================
           Mise à jour locale (utilisée par les actions ET le temps réel)
           ============================================================ */
        function upsertLocal(row, fromRemote) {
            const index = locations.findIndex(l => l.id === row.id);
            const previous = index >= 0 ? locations[index] : null;
            const site = previous ? { ...previous, ...row } : row;

            if (index >= 0) locations[index] = site;
            else locations.push(site);

            // Notification quand quelqu'un d'autre récupère / annule un point
            if (fromRemote && previous && previous.recovered !== site.recovered && site.recovered_by !== (me && me.id)) {
                if (site.recovered) toast(`${site.recovered_by_name || "Quelqu'un"} a récupéré « ${site.name} »`);
                else toast(`« ${site.name} » est repassé en attente`);
            }

            ensureMarker(site);
            refreshPopupIfOpen(site.id);
            refreshAll(false);
        }

        function removeLocal(id) {
            locations = locations.filter(l => l.id !== id);

            if (markers[id]) {
                map.removeLayer(markers[id]);
                delete markers[id];
            }

            refreshAll(false);
        }

        function upsertCategoryLocal(row) {
            const index = categories.findIndex(c => c.id === row.id);

            if (index >= 0) categories[index] = { ...categories[index], ...row };
            else categories.push(row);

            categories.sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)));

            updateAllIcons();
            refreshAll(false);
        }

        function removeCategoryLocal(id) {
            categories = categories.filter(c => c.id !== id);
            locations.forEach(s => { if (s.category_id === id) s.category_id = null; });

            if (profile && profile.hidden_categories.includes(id)) {
                profile.hidden_categories = profile.hidden_categories.filter(k => k !== id);
            }

            updateAllIcons();
            refreshAll(false);
        }

        function upsertSpeakerTypeLocal(row) {
            const index = speakerTypes.findIndex(t => t.id === row.id);

            if (index >= 0) speakerTypes[index] = { ...speakerTypes[index], ...row };
            else speakerTypes.push(row);

            speakerTypes.sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)));

            updateAllIcons();
            locations.forEach(s => refreshPopupIfOpen(s.id));
            refreshAll(false);
        }

        function removeSpeakerTypeLocal(id) {
            speakerTypes = speakerTypes.filter(t => t.id !== id);
            locations.forEach(s => { if (s.speaker_type_id === id) s.speaker_type_id = null; });

            if (profile && profile.hidden_types.includes(id)) {
                profile.hidden_types = profile.hidden_types.filter(k => k !== id);
            }

            updateAllIcons();
            refreshAll(false);
        }

        /* ============================================================
           Popups & marqueurs
           ============================================================ */
        // Taille des points sur la carte (réglable avec le curseur, mémorisée sur cet appareil)
        const MARKER_SIZE_MIN = 20;
        const MARKER_SIZE_MAX = 80;
        const MARKER_SIZE_DEFAULT = 38;

        let markerSize = MARKER_SIZE_DEFAULT;
        try {
            const saved = parseInt(localStorage.getItem("markerSize"), 10);
            if (saved >= MARKER_SIZE_MIN && saved <= MARKER_SIZE_MAX) markerSize = saved;
        } catch (e) { /* stockage indisponible : taille par défaut */ }

        function setMarkerSize(value) {
            markerSize = Math.min(MARKER_SIZE_MAX, Math.max(MARKER_SIZE_MIN, parseInt(value, 10) || MARKER_SIZE_DEFAULT));

            try { localStorage.setItem("markerSize", String(markerSize)); } catch (e) { /* ignoré */ }

            document.getElementById("sizeValue").textContent = markerSize;
            updateAllIcons();
        }

        function createIcon(site) {
            const size = markerSize;
            const svg = siteIconSvg(site, size, { outline: editMode });

            return L.divIcon({
                html: `<div style="filter: drop-shadow(0 1px 3px rgba(0,0,0,.65)); cursor: ${editMode ? 'move' : 'pointer'};">${svg}</div>`,
                className: '',
                iconSize: [size, size],
                popupAnchor: [0, -Math.round(size / 2)]   // le popup s'ouvre au-dessus du point, quelle que soit sa taille
            });
        }

        function createViewPopup(site) {
            const cat = getCategory(site);
            const type = getSpeakerType(site);
            const line = speakerLine(site);

            const meta = site.recovered
                ? `<div class="popup-meta">${site.recovered_by_name ? 'Par ' + escapeHtml(site.recovered_by_name) + '<br>' : ''}${site.recovered_at ? fmtDate(site.recovered_at) : ''}</div>`
                : '';

            const infoButton = type
                ? `<button class="popup-info" title="Infos sur l'enceinte" onclick="openInfo('${type.id}')">i</button>`
                : '';

            return `
                <div class="popup-header ${site.recovered ? 'done' : ''}">
                    <div class="popup-status">${site.recovered ? 'Récupéré' : 'En attente'}</div>
                    <h3 class="popup-title">${escapeHtml(site.name)}</h3>
                </div>
                <div class="popup-body">
                    ${line ? `
                        <div class="popup-type">
                            ${type ? typeBadge(type, 22) : ''}
                            <span>${escapeHtml(line)}</span>
                        </div>` : ''}
                    ${site.type ? `<div class="popup-material">${escapeHtml(site.type)}</div>` : ''}
                    ${cat ? `
                        <div class="popup-cat">
                            <span class="inline-icon">${catPreview(cat, 16)}</span>
                            ${escapeHtml(cat.name)}
                        </div>` : ''}
                    ${site.comment ? `<div class="popup-comment">💬 ${escapeHtml(site.comment)}</div>` : ''}
                    ${meta}
                    <div class="popup-row" style="margin-top:0;">
                        <button
                            class="popup-action ${site.recovered ? 'cancel' : ''}"
                            onclick="toggleRecovered('${site.id}', this)"
                        >
                            ${site.recovered ? 'Annuler' : 'Récupérer'}
                        </button>
                        ${infoButton}
                    </div>
                </div>
            `;
        }

        function createEditPopup(site) {
            const catOptions = categories.map(c => `
                <option value="${c.id}" ${c.id === site.category_id ? 'selected' : ''}>${escapeHtml(c.name)} (${SHAPE_NAMES[c.shape] || ''})</option>
            `).join("");

            const typeOptions = speakerTypes.map(t => `
                <option value="${t.id}" ${t.id === site.speaker_type_id ? 'selected' : ''}>${escapeHtml(t.name)}</option>
            `).join("");

            return `
                <div class="popup-header edit">
                    <div class="popup-status">Édition</div>
                    <h3 class="popup-title">${escapeHtml(site.name) || 'Sans nom'}</h3>
                </div>
                <div class="popup-body">
                    <label class="popup-label" for="edit-name">Nom</label>
                    <input class="popup-input" id="edit-name" type="text"
                           value="${escapeHtml(site.name)}"
                           onkeydown="if(event.key==='Enter') saveSite('${site.id}')">

                    <label class="popup-label" for="edit-speaker">Type d'enceinte / quantité</label>
                    <div class="popup-two">
                        <select class="popup-input" id="edit-speaker">
                            <option value="">Aucun type</option>
                            ${typeOptions}
                        </select>
                        <input class="popup-input" id="edit-qty" type="number" min="0" step="1"
                               placeholder="Qté" value="${site.quantity != null ? site.quantity : ''}"
                               onkeydown="if(event.key==='Enter') saveSite('${site.id}')">
                    </div>

                    <label class="popup-label" for="edit-cat">Catégorie</label>
                    <select class="popup-input" id="edit-cat">
                        <option value="">Sans catégorie</option>
                        ${catOptions}
                    </select>

                    <label class="popup-label" for="edit-type">Description / notes</label>
                    <input class="popup-input" id="edit-type" type="text"
                           value="${escapeHtml(site.type)}"
                           onkeydown="if(event.key==='Enter') saveSite('${site.id}')">

                    <div class="popup-row">
                        <button class="popup-action" onclick="saveSite('${site.id}')">Enregistrer</button>
                        <button class="popup-action danger" onclick="deleteSite('${site.id}')">Supprimer</button>
                    </div>
                    <div class="popup-coords">${site.lat.toFixed(5)}, ${site.lng.toFixed(5)}</div>
                </div>
            `;
        }

        function popupContent(siteId) {
            const site = getSite(siteId);
            if (!site) return "";
            return editMode ? createEditPopup(site) : createViewPopup(site);
        }

        function bindPopupFor(marker, siteId) {
            marker.unbindPopup();
            marker.bindPopup(() => popupContent(siteId), {
                minWidth: editMode ? 220 : 176,
                maxWidth: editMode ? 220 : 176,
                autoPan: false,
                className: "compact-material-popup" + (editMode ? " edit" : "")
            });
        }

        // Si un popup est ouvert en lecture quand un autre utilisateur modifie le point, on le met à jour
        function refreshPopupIfOpen(siteId) {
            const marker = markers[siteId];
            if (!editMode && marker && marker.isPopupOpen()) marker.getPopup().update();
        }

        function ensureMarker(site) {
            let marker = markers[site.id];

            if (!marker) {
                marker = L.marker([site.lat, site.lng], {
                    icon: createIcon(site),
                    draggable: editMode
                });

                marker.on("dragstart", () => { marker._drag = true; });

                marker.on("dragend", async () => {
                    marker._drag = false;
                    const pos = marker.getLatLng();

                    const { data, error } = await sb.from("locations")
                        .update({ lat: pos.lat, lng: pos.lng })
                        .eq("id", site.id)
                        .select()
                        .single();

                    if (error) {
                        toast("Déplacement refusé : " + error.message, true);
                        const current = getSite(site.id);
                        if (current) marker.setLatLng([current.lat, current.lng]);
                        return;
                    }

                    upsertLocal(data);
                });

                markers[site.id] = marker;
                bindPopupFor(marker, site.id);
            } else {
                marker.setIcon(createIcon(site));
                if (!marker._drag) marker.setLatLng([site.lat, site.lng]);
            }

            return marker;
        }

        function rebuildMarkers() {
            map.closePopup();

            Object.keys(markers).forEach(id => {
                map.removeLayer(markers[id]);
                delete markers[id];
            });

            locations.forEach(ensureMarker);
        }

        function updateAllIcons() {
            locations.forEach(site => {
                if (markers[site.id]) markers[site.id].setIcon(createIcon(site));
            });
        }

        function applyModeToMarkers() {
            map.closePopup();

            locations.forEach(site => {
                const marker = markers[site.id];
                if (!marker) return;

                marker.options.draggable = editMode;
                marker.setIcon(createIcon(site));

                if (marker.dragging) {
                    if (editMode) marker.dragging.enable();
                    else marker.dragging.disable();
                }

                bindPopupFor(marker, site.id);
            });
        }

        /* ============================================================
           Filtres personnels (par utilisateur) : catégories + types
           ============================================================ */
        function isVisible(site) {
            const catKey = getCategory(site) ? site.category_id : "none";
            const typeKey = getSpeakerType(site) ? site.speaker_type_id : "none";
            return !hiddenCats().has(catKey) && !hiddenTypes().has(typeKey);
        }

        function applyFilter() {
            locations.forEach(site => {
                const marker = markers[site.id];
                if (!marker) return;

                if (isVisible(site)) {
                    if (!map.hasLayer(marker)) marker.addTo(map);
                } else if (map.hasLayer(marker)) {
                    map.removeLayer(marker);
                }
            });
        }

        function filterItemHtml(kind, item, hidden) {
            const handler = kind === "cat" ? "setCategoryVisible" : "setTypeVisible";
            return `
                <label class="filter-item">
                    <input type="checkbox" ${hidden.has(item.key) ? '' : 'checked'}
                           onchange="${handler}('${item.key}', this.checked)">
                    <span class="filter-visual">${item.visual}</span>
                    <span class="filter-name">${escapeHtml(item.name)}</span>
                    <span class="count">${item.count}</span>
                </label>
            `;
        }

        function renderFilter() {
            const panel = document.getElementById("filterPanel");
            const hasCats = categories.length > 0;
            const hasTypes = speakerTypes.length > 0;

            panel.style.display = (hasCats || hasTypes) ? "block" : "none";

            // --- Catégories (formes) ---
            document.getElementById("filterCatsTitle").style.display = hasCats ? "block" : "none";

            const hc = hiddenCats();
            const catItems = categories.map(c => ({
                key: c.id,
                name: c.name,
                count: locations.filter(s => s.category_id === c.id).length,
                visual: catPreview(c, 22)
            }));

            const noCat = locations.filter(s => !getCategory(s)).length;
            if (hasCats && (noCat > 0 || hc.has("none"))) {
                catItems.push({ key: "none", name: "Sans catégorie", count: noCat, visual: catPreview(null, 22) });
            }

            document.getElementById("filterCats").innerHTML = catItems.map(i => filterItemHtml("cat", i, hc)).join("");

            // --- Types d'enceinte (couleurs) ---
            document.getElementById("filterTypesTitle").style.display = hasTypes ? "block" : "none";

            const ht = hiddenTypes();
            const typeItems = speakerTypes.map(t => ({
                key: t.id,
                name: t.name,
                count: locations.filter(s => s.speaker_type_id === t.id).length,
                visual: typeBadge(t, 22)
            }));

            const noType = locations.filter(s => !getSpeakerType(s)).length;
            if (hasTypes && (noType > 0 || ht.has("none"))) {
                typeItems.push({ key: "none", name: "Sans type", count: noType, visual: typeBadge(null, 22) });
            }

            document.getElementById("filterTypes").innerHTML = typeItems.map(i => filterItemHtml("type", i, ht)).join("");
        }

        async function saveHidden() {
            if (!profile || !me) return;

            const { error } = await sb.from("profiles")
                .update({
                    hidden_categories: profile.hidden_categories,
                    hidden_types: profile.hidden_types
                })
                .eq("id", me.id);

            if (error) toast("Filtre non sauvegardé : " + error.message, true);
        }

        function setCategoryVisible(key, visible) {
            const set = hiddenCats();
            if (visible) set.delete(key); else set.add(key);

            profile.hidden_categories = [...set];
            map.closePopup();
            refreshAll(false);
            saveHidden();
        }

        function setTypeVisible(key, visible) {
            const set = hiddenTypes();
            if (visible) set.delete(key); else set.add(key);

            profile.hidden_types = [...set];
            map.closePopup();
            refreshAll(false);
            saveHidden();
        }

        function showAllFilters() {
            profile.hidden_categories = [];
            profile.hidden_types = [];
            map.closePopup();
            refreshAll(false);
            saveHidden();
        }

        /* ============================================================
           Liste latérale & progression
           ============================================================ */
        function statusHtml(site) {
            return site.recovered
                ? `✅ Récupéré${site.recovered_by_name ? ' · ' + escapeHtml(site.recovered_by_name) : ''}${site.recovered_at ? ' <small>(' + fmtDate(site.recovered_at) + ')</small>' : ''}`
                : '❌ En attente';
        }

        function zoneHtml(site) {
            const type = getSpeakerType(site);
            const line = speakerLine(site);

            return `
                <div class="zone ${site.recovered ? 'done' : ''}"
                     style="border-left-color: ${type ? type.color : '#ddd'}"
                     onclick="focusSite('${site.id}')">
                    <div class="zone-head">
                        ${siteIconSvg(site, 36, { shadow: true })}
                        <strong>${escapeHtml(site.name)}</strong>
                    </div>
                    ${line ? `<div class="zone-speaker">${escapeHtml(line)}</div>` : ''}
                    ${site.type ? `<div class="zone-desc">${escapeHtml(site.type)}</div>` : ''}
                    <div style="margin-top:3px;">${statusHtml(site)}</div>
                </div>
            `;
        }

        function refresh() {
            applyFilter();

            const visible = locations.filter(isVisible);

            const groups = categories.map(c => ({
                name: c.name,
                cat: c,
                sites: visible.filter(s => s.category_id === c.id)
            }));
            groups.push({
                name: "Sans catégorie",
                cat: null,
                sites: visible.filter(s => !getCategory(s))
            });

            let html = "";

            groups.forEach(group => {
                if (!group.sites.length) return;

                if (categories.length) {
                    const doneInGroup = group.sites.filter(s => s.recovered).length;
                    html += `
                        <div class="group-header">
                            ${catPreview(group.cat, 20)}
                            ${escapeHtml(group.name)}
                            <span class="count">${doneInGroup}/${group.sites.length}</span>
                        </div>
                    `;
                }

                html += group.sites.map(zoneHtml).join("");
            });

            document.getElementById("zoneList").innerHTML = html;

            const doneCount = visible.filter(s => s.recovered).length;
            const percent = visible.length ? Math.round(doneCount / visible.length * 100) : 0;

            document.getElementById("progressText").textContent = percent + "%";
            document.getElementById("progressBar").style.width = percent + "%";
        }

        function refreshAll(force) {
            renderCatManager(force);
            renderFilter();
            refresh();
            renderGear(force);
        }

        const isMobile = () => window.matchMedia("(max-width: 700px)").matches;

        function focusSite(siteId) {
            const marker = markers[siteId];
            if (!marker || !map.hasLayer(marker)) return;

            map.panTo(marker.getLatLng());
            marker.openPopup();

            if (isMobile()) document.getElementById("sidebar").classList.add("collapsed");
        }

        function toggleSidebar() {
            document.getElementById("sidebar").classList.toggle("collapsed");
        }

        /* ============================================================
           Pages : Carte / Matériel
           ============================================================ */
        function showPage(target) {
            page = target;

            document.body.classList.toggle("page-gear", target === "gear");
            document.getElementById("navMap").classList.toggle("active", target === "map");
            document.getElementById("navGear").classList.toggle("active", target === "gear");

            closeModal();

            if (target === "gear") {
                map.closePopup();
                renderGear(true);
            } else {
                setTimeout(() => map.invalidateSize(), 0);
            }
        }

        // Aller voir un point sur la carte (depuis la page Matériel)
        function gotoSite(siteId) {
            const site = getSite(siteId);
            if (!site) return;

            closeModal();

            // Si les filtres de l'utilisateur masquent ce point, on les ajuste
            if (!isVisible(site)) {
                const catKey = getCategory(site) ? site.category_id : "none";
                const typeKey = getSpeakerType(site) ? site.speaker_type_id : "none";

                profile.hidden_categories = profile.hidden_categories.filter(k => k !== catKey);
                profile.hidden_types = profile.hidden_types.filter(k => k !== typeKey);
                saveHidden();
                refreshAll(false);
                toast("Filtres ajustés pour afficher ce point");
            }

            showPage("map");

            setTimeout(() => {
                const marker = markers[siteId];
                if (!marker) return;

                map.invalidateSize();
                map.setView(marker.getLatLng(), Math.max(map.getZoom(), 17));
                marker.openPopup();

                if (isMobile()) document.getElementById("sidebar").classList.add("collapsed");
            }, 60);
        }

        /* ============================================================
           Fenêtre modale
           ============================================================ */
        function openModal(html) {
            document.getElementById("modalCard").innerHTML = html;
            document.getElementById("modal").classList.add("show");
        }

        function closeModal() {
            document.getElementById("modal").classList.remove("show");
            document.getElementById("modalCard").innerHTML = "";
        }

        document.addEventListener("keydown", e => {
            if (e.key === "Escape") closeModal();
        });

        /* ============================================================
           Profils d'enceintes : affichage
           ============================================================ */
        function typeStats(typeId) {
            const sites = locations.filter(s => s.speaker_type_id === typeId);
            return {
                sites,
                points: sites.length,
                qty: sites.reduce((sum, s) => sum + (s.quantity || 0), 0),
                recovered: sites.filter(s => s.recovered).length
            };
        }

        function profileBodyHtml(type) {
            const specs = (Array.isArray(type.specs) ? type.specs : []).filter(s => s && (s.label || s.value));
            const url = safeUrl(type.datasheet_url);
            const parts = [];

            if (type.description) parts.push(`<p class="profile-desc">${multiline(type.description)}</p>`);

            if (specs.length) {
                parts.push(`
                    <table class="spec-table">
                        ${specs.map(s => `<tr><td>${escapeHtml(s.label)}</td><td>${multiline(s.value)}</td></tr>`).join("")}
                    </table>
                `);
            }

            if (url) {
                parts.push(`<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">📄 Fiche technique</a></p>`);
            }

            if (type.notes) {
                parts.push(`<div class="profile-notes"><strong>Remarques</strong><br>${multiline(type.notes)}</div>`);
            }

            return parts.length ? parts.join("") : `<p class="empty" style="padding:0;">Aucun renseignement saisi pour ce profil.</p>`;
        }

        const typeSubtitle = type => [type.manufacturer, type.model].filter(Boolean).join(" · ");

        // Fiche d'info ouverte depuis le bouton "i" du popup
        function openInfo(typeId) {
            const type = speakerTypes.find(t => t.id === typeId);
            if (!type) return;

            const st = typeStats(type.id);

            openModal(`
                <div class="detail-head">
                    ${typeBadge(type, 48)}
                    <div class="detail-title">
                        <h2 style="margin:0;">${escapeHtml(type.name)}</h2>
                        <div class="gear-sub">${escapeHtml(typeSubtitle(type))}</div>
                    </div>
                </div>
                ${profileBodyHtml(type)}
                <div class="deploy-summary">
                    <strong>${st.qty}</strong> enceinte(s) déployée(s) sur <strong>${st.points}</strong> point(s)
                </div>
                <div class="modal-actions">
                    <button class="btn" onclick="openGearFromModal('${type.id}')">Voir dans le matériel</button>
                    <button class="btn secondary" onclick="closeModal()">Fermer</button>
                </div>
            `);
        }

        function openGearFromModal(typeId) {
            closeModal();
            gearTypeId = typeId;
            showPage("gear");
        }

        /* ============================================================
           Page Matériel
           ============================================================ */
        function renderGear(force) {
            if (page !== "gear") return;

            const root = document.getElementById("gearPage");
            const active = document.activeElement;

            // On ne réécrit pas la page pendant qu'on y tape un commentaire
            if (!force && root.contains(active) && /^(TEXTAREA|INPUT)$/.test(active.tagName)) return;

            const type = gearTypeId ? speakerTypes.find(t => t.id === gearTypeId) : null;
            if (gearTypeId && !type) gearTypeId = null;

            root.innerHTML = type ? gearDetailHtml(type) : gearListHtml();
        }

        function gearListHtml() {
            const cards = speakerTypes.map(type => {
                const st = typeStats(type.id);
                return `
                    <div class="gear-card" style="border-top-color:${type.color}" onclick="openGearType('${type.id}')">
                        <div class="gear-card-head">
                            ${typeBadge(type, 46)}
                            <div>
                                <div class="gear-name">${escapeHtml(type.name)}</div>
                                <div class="gear-sub">${escapeHtml(typeSubtitle(type)) || '&nbsp;'}</div>
                            </div>
                        </div>
                        <div class="gear-stats">
                            <span><strong>${st.qty}</strong> enceinte(s)</span>
                            <span><strong>${st.points}</strong> point(s)</span>
                            <span><strong>${st.recovered}/${st.points}</strong> récupéré(s)</span>
                        </div>
                    </div>
                `;
            }).join("");

            const addButton = isAdmin()
                ? `<button class="btn" onclick="openTypeEditor(null)">＋ Nouveau profil d'enceinte</button>`
                : "";

            return `
                <div class="gear-header">
                    <h1>🔊 Matériel</h1>
                    ${addButton}
                </div>
                ${speakerTypes.length
                    ? `<div class="gear-grid">${cards}</div>`
                    : `<div class="empty">Aucun profil d'enceinte pour l'instant.${isAdmin() ? " Crée le premier avec le bouton ci-dessus." : ""}</div>`}
            `;
        }

        function gearDetailHtml(type) {
            const st = typeStats(type.id);
            const sites = [...st.sites].sort((a, b) => a.name.localeCompare(b.name, "fr"));

            const editButton = isAdmin()
                ? `<button class="btn" onclick="openTypeEditor('${type.id}')">✏️ Modifier</button>`
                : "";

            return `
                <button class="link-btn back" onclick="closeGearType()">← Tous les profils</button>

                <div class="panel" style="border-top: 6px solid ${type.color};">
                    <div class="detail-head">
                        ${typeBadge(type, 56)}
                        <div class="detail-title">
                            <h1>${escapeHtml(type.name)}</h1>
                            <div class="gear-sub">${escapeHtml(typeSubtitle(type))}</div>
                        </div>
                        ${editButton}
                    </div>
                    ${profileBodyHtml(type)}
                </div>

                <div class="panel">
                    <h2>Déploiement</h2>
                    <div class="deploy-summary">
                        <strong>${st.qty}</strong> enceinte(s) sur <strong>${st.points}</strong> point(s)
                        · <strong>${st.recovered}</strong> récupéré(s)
                    </div>
                    ${sites.length
                        ? sites.map(deployHtml).join("")
                        : `<div class="empty">Aucun point n'utilise ce type pour l'instant.</div>`}
                </div>
            `;
        }

        function commentMetaText(site) {
            return site.comment_at
                ? `Modifié par ${site.comment_by_name || "?"} · ${fmtDate(site.comment_at)}`
                : "";
        }

        function deployHtml(site) {
            const cat = getCategory(site);

            return `
                <div class="deploy ${site.recovered ? 'done' : ''}">
                    <div class="deploy-top">
                        ${siteIconSvg(site, 38, { shadow: true })}
                        <div class="deploy-info">
                            <strong>${escapeHtml(site.name)}</strong>${site.quantity != null ? ` · × ${site.quantity}` : ''}
                            <div class="deploy-sub">
                                <span class="inline-icon">${catPreview(cat, 14)}</span>${cat ? escapeHtml(cat.name) : 'Sans catégorie'}
                                ${site.type ? ' · ' + escapeHtml(site.type) : ''}
                            </div>
                            <div>${statusHtml(site)}</div>
                        </div>
                        <button class="btn secondary small" onclick="gotoSite('${site.id}')">📍 Voir sur la carte</button>
                    </div>

                    <label class="popup-label" for="cm-${site.id}">Commentaire</label>
                    <textarea class="popup-input" id="cm-${site.id}" rows="2"
                              placeholder="Ajouter un commentaire…"
                              onchange="saveComment('${site.id}', this)">${escapeHtml(site.comment || '')}</textarea>
                    <div class="deploy-meta" id="cmeta-${site.id}">${escapeHtml(commentMetaText(site))}</div>
                </div>
            `;
        }

        function openGearType(typeId) {
            gearTypeId = typeId;
            renderGear(true);
            document.getElementById("gearPage").scrollTop = 0;
        }

        function closeGearType() {
            gearTypeId = null;
            renderGear(true);
            document.getElementById("gearPage").scrollTop = 0;
        }

        // Commentaire : enregistré automatiquement quand on quitte le champ (tout utilisateur)
        async function saveComment(siteId, textarea) {
            const site = getSite(siteId);
            if (!site) return;

            const comment = textarea.value.trim();
            if (comment === (site.comment || "")) return;

            const { data, error } = await sb.from("locations")
                .update({ comment })
                .eq("id", siteId)
                .select()
                .single();

            if (error) {
                toast("Commentaire non enregistré : " + error.message, true);
                return;
            }

            upsertLocal(data);

            const meta = document.getElementById("cmeta-" + siteId);
            if (meta) meta.textContent = commentMetaText(data);

            toast("Commentaire enregistré ✅");
        }

        /* ============================================================
           Profils d'enceintes : création / édition (admin)
           ============================================================ */
        function nextTypeColor() {
            const used = new Set(speakerTypes.map(t => t.color));
            return TYPE_COLORS.find(c => !used.has(c)) || TYPE_COLORS[speakerTypes.length % TYPE_COLORS.length];
        }

        function addSpecRow(label = "", value = "") {
            const container = document.getElementById("ed-specs");
            if (!container) return;

            const row = document.createElement("div");
            row.className = "spec-row";
            row.innerHTML = `
                <input class="popup-input spec-label" type="text" placeholder="Caractéristique">
                <input class="popup-input spec-value" type="text" placeholder="Valeur">
                <button class="cat-del" type="button" title="Retirer cette ligne">✕</button>
            `;

            row.querySelector(".spec-label").value = label;
            row.querySelector(".spec-value").value = value;
            row.querySelector("button").onclick = () => row.remove();

            container.appendChild(row);

            if (!label) row.querySelector(".spec-label").focus();
            else if (!value) row.querySelector(".spec-value").focus();
        }

        function openTypeEditor(typeId) {
            if (!isAdmin()) return;

            const type = typeId ? speakerTypes.find(t => t.id === typeId) : null;
            if (typeId && !type) return;

            const t = type || {
                name: "", label: "", color: nextTypeColor(), manufacturer: "", model: "",
                description: "", datasheet_url: "", specs: [], notes: ""
            };

            openModal(`
                <h2 style="margin-top:0;">${type ? "Modifier le profil" : "Nouveau profil d'enceinte"}</h2>

                <label class="popup-label" for="ed-name">Nom *</label>
                <input class="popup-input" id="ed-name" type="text" value="${escapeHtml(t.name)}" placeholder="ex : KARA II">

                <div class="ed-row">
                    <div>
                        <label class="popup-label" for="ed-color">Couleur sur la carte</label>
                        <input class="color-input" id="ed-color" type="color" value="${t.color}">
                    </div>
                    <div>
                        <label class="popup-label" for="ed-label">Code (1 à 3 car.)</label>
                        <input class="popup-input" id="ed-label" type="text" maxlength="3" value="${escapeHtml(t.label)}" placeholder="auto"
                               style="text-transform:uppercase; height:34px;">
                    </div>
                </div>
                <div class="swatches">
                    ${TYPE_COLORS.map(c => `<button type="button" class="swatch" style="background:${c}"
                        onclick="document.getElementById('ed-color').value='${c}'"></button>`).join("")}
                </div>

                <div class="ed-row">
                    <div>
                        <label class="popup-label" for="ed-manu">Fabricant</label>
                        <input class="popup-input" id="ed-manu" type="text" value="${escapeHtml(t.manufacturer)}">
                    </div>
                    <div>
                        <label class="popup-label" for="ed-model">Modèle / référence</label>
                        <input class="popup-input" id="ed-model" type="text" value="${escapeHtml(t.model)}">
                    </div>
                </div>

                <label class="popup-label" for="ed-desc">Description</label>
                <textarea class="popup-input" id="ed-desc" rows="3">${escapeHtml(t.description)}</textarea>

                <label class="popup-label" for="ed-url">Fiche technique (lien)</label>
                <input class="popup-input" id="ed-url" type="url" value="${escapeHtml(t.datasheet_url)}" placeholder="https://…">

                <label class="popup-label">Caractéristiques</label>
                <div id="ed-specs"></div>
                <div class="chips">
                    ${SPEC_SUGGESTIONS.map(s => `<button type="button" class="chip" onclick="addSpecRow('${s}')">+ ${s}</button>`).join("")}
                    <button type="button" class="chip" onclick="addSpecRow()">+ Autre…</button>
                </div>

                <label class="popup-label" for="ed-notes">Remarques générales</label>
                <textarea class="popup-input" id="ed-notes" rows="3">${escapeHtml(t.notes)}</textarea>

                <div class="modal-actions">
                    <button class="btn" onclick="saveTypeEditor(${type ? `'${type.id}'` : 'null'})">Enregistrer</button>
                    <button class="btn secondary" onclick="closeModal()">Annuler</button>
                    <span class="spacer"></span>
                    ${type ? `<button class="btn danger" onclick="deleteSpeakerType('${type.id}')">Supprimer</button>` : ''}
                </div>
            `);

            (Array.isArray(t.specs) ? t.specs : []).forEach(s => addSpecRow(s.label || "", s.value || ""));
            document.getElementById("ed-name").focus();
        }

        async function saveTypeEditor(typeId) {
            if (!isAdmin()) return;

            const val = id => document.getElementById(id).value.trim();
            const name = val("ed-name");

            if (!name) {
                toast("Le nom est obligatoire", true);
                document.getElementById("ed-name").focus();
                return;
            }

            const url = val("ed-url");
            if (url && !safeUrl(url)) {
                toast("Le lien doit commencer par http:// ou https://", true);
                return;
            }

            const specs = [...document.querySelectorAll("#ed-specs .spec-row")]
                .map(row => ({
                    label: row.querySelector(".spec-label").value.trim(),
                    value: row.querySelector(".spec-value").value.trim()
                }))
                .filter(s => s.label || s.value);

            const payload = {
                name,
                label: (val("ed-label") || autoLabel(name)).toUpperCase().slice(0, 3),
                color: document.getElementById("ed-color").value,
                manufacturer: val("ed-manu"),
                model: val("ed-model"),
                description: val("ed-desc"),
                datasheet_url: url,
                specs,
                notes: val("ed-notes")
            };

            let result;

            if (typeId) {
                result = await sb.from("speaker_types").update(payload).eq("id", typeId).select().single();
            } else {
                const position = speakerTypes.reduce((max, t) => Math.max(max, t.position || 0), 0) + 1;
                result = await sb.from("speaker_types")
                    .insert({ ...payload, id: randomId("type-"), position })
                    .select()
                    .single();
            }

            if (result.error) {
                toast("Profil non enregistré : " + result.error.message, true);
                return;
            }

            closeModal();
            map.closePopup();
            upsertSpeakerTypeLocal(result.data);

            if (!typeId) gearTypeId = result.data.id;   // on ouvre directement le nouveau profil

            refreshAll(true);
            toast("Profil enregistré ✅");
        }

        async function deleteSpeakerType(typeId) {
            if (!isAdmin()) return;

            const type = speakerTypes.find(t => t.id === typeId);
            if (!type) return;

            const count = locations.filter(s => s.speaker_type_id === typeId).length;
            const msg = count
                ? `Supprimer le profil « ${type.name} » pour tout le monde ? Ses ${count} point(s) passeront en « Sans type ».`
                : `Supprimer le profil « ${type.name} » ?`;

            if (!confirm(msg)) return;

            const { error } = await sb.from("speaker_types").delete().eq("id", typeId);

            if (error) {
                toast("Suppression impossible : " + error.message, true);
                return;
            }

            closeModal();
            map.closePopup();
            if (gearTypeId === typeId) gearTypeId = null;
            removeSpeakerTypeLocal(typeId);
            refreshAll(true);
        }

        /* ============================================================
           Action pour tous : récupérer / annuler
           ============================================================ */
        async function toggleRecovered(siteId, button) {
            const site = getSite(siteId);
            if (!site) return;

            if (button) button.disabled = true;

            const { data, error } = await sb.from("locations")
                .update({ recovered: !site.recovered })
                .eq("id", siteId)
                .select()
                .single();

            if (error) {
                if (button) button.disabled = false;
                toast("Action impossible : " + error.message, true);
                return;
            }

            map.closePopup();
            upsertLocal(data);
        }

        /* ============================================================
           Actions admin : points
           ============================================================ */
        async function saveSite(siteId) {
            if (!isAdmin()) return;

            const name = document.getElementById("edit-name").value.trim();
            const type = document.getElementById("edit-type").value.trim();
            const cat = document.getElementById("edit-cat").value;
            const speaker = document.getElementById("edit-speaker").value;
            const qtyRaw = document.getElementById("edit-qty").value.trim();
            const quantity = qtyRaw === "" ? null : Math.max(0, parseInt(qtyRaw, 10) || 0);

            const { data, error } = await sb.from("locations")
                .update({
                    name: name || "Sans nom",
                    type,
                    category_id: cat || null,
                    speaker_type_id: speaker || null,
                    quantity
                })
                .eq("id", siteId)
                .select()
                .single();

            if (error) {
                toast("Enregistrement impossible : " + error.message, true);
                return;
            }

            map.closePopup();
            upsertLocal(data);
            refreshAll(true);
        }

        async function deleteSite(siteId) {
            if (!isAdmin()) return;

            const site = getSite(siteId);
            if (!site || !confirm(`Supprimer « ${site.name} » pour tout le monde ?`)) return;

            const { error } = await sb.from("locations").delete().eq("id", siteId);

            if (error) {
                toast("Suppression impossible : " + error.message, true);
                return;
            }

            map.closePopup();
            removeLocal(siteId);
            refreshAll(true);
        }

        async function createSiteAt(latlng) {
            if (!isAdmin()) return;

            // Un nouveau point (sans catégorie ni type) doit rester visible pour être édité
            if (hiddenCats().has("none") || hiddenTypes().has("none")) {
                profile.hidden_categories = profile.hidden_categories.filter(k => k !== "none");
                profile.hidden_types = profile.hidden_types.filter(k => k !== "none");
                saveHidden();
            }

            const { data, error } = await sb.from("locations")
                .insert({
                    id: randomId("pt-"),
                    name: "Nouveau point",
                    type: "",
                    lat: latlng.lat,
                    lng: latlng.lng,
                    category_id: null,
                    speaker_type_id: null,
                    quantity: null
                })
                .select()
                .single();

            if (error) {
                toast("Création impossible : " + error.message, true);
                return;
            }

            upsertLocal(data);
            refreshAll(true);

            const marker = markers[data.id];
            if (marker) {
                marker.openPopup();

                const nameInput = document.getElementById("edit-name");
                if (nameInput) {
                    nameInput.focus();
                    nameInput.select();
                }
            }
        }

        /* ============================================================
           Actions admin : catégories (une forme chacune, 6 maximum)
           ============================================================ */
        function shapeOptionsHtml(selected, usedByOthers) {
            return SHAPE_KEYS
                .filter(s => s === selected || !usedByOthers.has(s))
                .map(s => `<option value="${s}" ${s === selected ? 'selected' : ''}>${SHAPE_NAMES[s]}</option>`)
                .join("");
        }

        function renderCatManager(force) {
            const box = document.getElementById("catManager");

            // On ne réécrit pas la liste pendant qu'un admin est en train d'y taper
            if (!force && box.contains(document.activeElement)) return;

            const usedShapes = new Set(categories.map(c => c.shape));

            if (!categories.length) {
                box.innerHTML = `<div class="edit-hint" style="margin-bottom:6px;color:#64748b;">Aucune catégorie pour l'instant.</div>`;
            } else {
                box.innerHTML = categories.map(c => {
                    const count = locations.filter(s => s.category_id === c.id).length;
                    const others = new Set([...usedShapes].filter(s => s !== c.shape));

                    return `
                        <div class="type-row">
                            <div class="type-preview">${catPreview(c, 32)}</div>
                            <div class="type-fields">
                                <input type="text" value="${escapeHtml(c.name)}"
                                       onchange="updateCategory('${c.id}', 'name', this.value)">
                                <div class="type-sub">
                                    <select onchange="updateCategory('${c.id}', 'shape', this.value)">
                                        ${shapeOptionsHtml(c.shape, others)}
                                    </select>
                                </div>
                            </div>
                            <div class="type-side">
                                <span class="cat-count" title="Points dans cette catégorie">${count}</span>
                                <button class="cat-del" title="Supprimer la catégorie"
                                        onclick="deleteCategory('${c.id}')">✕</button>
                            </div>
                        </div>
                    `;
                }).join("");
            }

            // Formulaire d'ajout : uniquement les formes encore libres
            const full = categories.length >= MAX_CATEGORIES;
            document.getElementById("catAdd").style.display = full ? "none" : "block";
            document.getElementById("catLimit").style.display = full ? "block" : "none";
            document.getElementById("newCatShape").innerHTML = shapeOptionsHtml(null, usedShapes);
        }

        async function addCategory() {
            if (!isAdmin()) return;

            const nameInput = document.getElementById("newCatName");
            const name = nameInput.value.trim();
            const shape = document.getElementById("newCatShape").value;

            if (!name) {
                nameInput.focus();
                return;
            }

            if (categories.length >= MAX_CATEGORIES || !shape) {
                toast("Maximum de 6 catégories atteint", true);
                return;
            }

            const position = categories.reduce((max, c) => Math.max(max, c.position || 0), 0) + 1;

            const { data, error } = await sb.from("categories")
                .insert({ id: randomId("cat-"), name, shape, position })
                .select()
                .single();

            if (error) {
                toast("Catégorie non créée : " + error.message, true);
                return;
            }

            nameInput.value = "";
            upsertCategoryLocal(data);
            refreshAll(true);
            nameInput.focus();
        }

        async function updateCategory(catId, field, value) {
            if (!isAdmin()) return;

            if (field === "name") {
                value = value.trim();
                if (!value) {            // nom vide : on garde l'ancien
                    renderCatManager(true);
                    return;
                }
            }

            const { data, error } = await sb.from("categories")
                .update({ [field]: value })
                .eq("id", catId)
                .select()
                .single();

            if (error) {
                toast("Modification impossible : " + error.message, true);
                renderCatManager(true);
                return;
            }

            map.closePopup();
            upsertCategoryLocal(data);
            refreshAll(true);
        }

        async function deleteCategory(catId) {
            if (!isAdmin()) return;

            const cat = categories.find(c => c.id === catId);
            if (!cat) return;

            const count = locations.filter(s => s.category_id === catId).length;
            const msg = count
                ? `Supprimer la catégorie « ${cat.name} » pour tout le monde ? Ses ${count} point(s) passeront en « Sans catégorie ».`
                : `Supprimer la catégorie « ${cat.name} » ?`;

            if (!confirm(msg)) return;

            const { error } = await sb.from("categories").delete().eq("id", catId);

            if (error) {
                toast("Suppression impossible : " + error.message, true);
                return;
            }

            map.closePopup();
            removeCategoryLocal(catId);
            refreshAll(true);
        }

        /* ============================================================
           Mode édition (admin)
           ============================================================ */
        function setPlacing(value) {
            placing = value;
            document.getElementById("map").classList.toggle("placing", value);
            document.getElementById("addChip").classList.toggle("armed", value);
        }

        function toggleEditMode() {
            if (!isAdmin()) return;

            editMode = !editMode;
            document.body.classList.toggle("editing", editMode);

            const btn = document.getElementById("editToggle");
            btn.textContent = editMode ? "✅ Terminer l'édition" : "✏️ Mode édition";
            btn.classList.toggle("active", editMode);

            setPlacing(false);
            applyModeToMarkers();
            refreshAll(true);
        }

        /* Ajout par glisser-déposer */
        const chip = document.getElementById("addChip");
        const mapEl = document.getElementById("map");

        chip.addEventListener("dragstart", e => {
            e.dataTransfer.setData("text/plain", "new-point");
            e.dataTransfer.effectAllowed = "copy";
        });

        mapEl.addEventListener("dragover", e => {
            if (!editMode) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });

        mapEl.addEventListener("drop", e => {
            if (!editMode) return;
            e.preventDefault();
            createSiteAt(map.mouseEventToLatLng(e));
        });

        /* Alternative : clic sur le bloc puis clic sur la carte (pratique au tactile) */
        chip.addEventListener("click", () => setPlacing(!placing));

        map.on("click", e => {
            if (editMode && placing) {
                setPlacing(false);
                createSiteAt(e.latlng);
            }
        });

        /* ============================================================
           Initialisation
           ============================================================ */
        if (isMobile()) {
            document.getElementById("sidebar").classList.add("collapsed");
        }

        setAuthMode("login");

        // Curseur de taille : on le cale sur la valeur mémorisée
        document.getElementById("sizeSlider").value = markerSize;
        document.getElementById("sizeValue").textContent = markerSize;

        sb.auth.onAuthStateChange((event, session) => {
            // Ne jamais appeler Supabase directement dans ce callback : on décale
            setTimeout(async () => {
                await handleSession(session);

                if (event === "PASSWORD_RECOVERY") {
                    const pw = prompt("Choisis ton nouveau mot de passe (6 caractères min.) :");
                    if (pw && pw.length >= 6) {
                        const { error } = await sb.auth.updateUser({ password: pw });
                        toast(error ? "Mot de passe non modifié : " + error.message : "Mot de passe mis à jour ✅", !!error);
                    }
                }
            }, 0);
        });

        // Sécurité : si l'événement initial n'est jamais reçu, on vérifie la session nous-mêmes
        sb.auth.getSession().then(({ data }) => handleSession(data.session));

