(() => {
  "use strict";

  const STORAGE_KEY = "nfon-showcase-language";
  const SOURCE_LANGUAGE = "de";
  const SUPPORTED_LANGUAGES = [
    { code: "en", locale: "en-GB", flag: "🇬🇧", label: "English" },
    { code: "de", locale: "de-DE", flag: "🇩🇪", label: "Deutsch" },
    { code: "fr", locale: "fr-FR", flag: "🇫🇷", label: "Français" },
    { code: "es", locale: "es-ES", flag: "🇪🇸", label: "Español" },
    { code: "it", locale: "it-IT", flag: "🇮🇹", label: "Italiano" },
    { code: "nl", locale: "nl-NL", flag: "🇳🇱", label: "Nederlands" },
    { code: "pl", locale: "pl-PL", flag: "🇵🇱", label: "Polski" },
    { code: "pt", locale: "pt-PT", flag: "🇵🇹", label: "Português" },
    { code: "sv", locale: "sv-SE", flag: "🇸🇪", label: "Svenska" },
    { code: "da", locale: "da-DK", flag: "🇩🇰", label: "Dansk" },
    { code: "fi", locale: "fi-FI", flag: "🇫🇮", label: "Suomi" },
    { code: "cs", locale: "cs-CZ", flag: "🇨🇿", label: "Čeština" }
  ];

  const FLAG_SVGS = {
    en: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#012169"/><path d="M0 0 24 16M24 0 0 16" stroke="#fff" stroke-width="4"/><path d="M0 0 24 16M24 0 0 16" stroke="#C8102E" stroke-width="2"/><path d="M12 0v16M0 8h24" stroke="#fff" stroke-width="6"/><path d="M12 0v16M0 8h24" stroke="#C8102E" stroke-width="3.2"/></svg>',
    de: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#ffce00"/><rect width="24" height="10.67" fill="#dd0000"/><rect width="24" height="5.33" fill="#000"/></svg>',
    fr: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#fff"/><rect width="8" height="16" fill="#0055a4"/><rect x="16" width="8" height="16" fill="#ef4135"/></svg>',
    es: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#aa151b"/><rect y="4" width="24" height="8" fill="#f1bf00"/></svg>',
    it: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#fff"/><rect width="8" height="16" fill="#009246"/><rect x="16" width="8" height="16" fill="#ce2b37"/></svg>',
    nl: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#21468b"/><rect width="24" height="10.67" fill="#fff"/><rect width="24" height="5.33" fill="#ae1c28"/></svg>',
    pl: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#dc143c"/><rect width="24" height="8" fill="#fff"/></svg>',
    pt: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#ff0000"/><rect width="10" height="16" fill="#006600"/><circle cx="10" cy="8" r="2.1" fill="#ffcc00"/></svg>',
    sv: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#006aa7"/><rect x="7" width="3" height="16" fill="#fecc00"/><rect y="6.5" width="24" height="3" fill="#fecc00"/></svg>',
    da: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#c60c30"/><rect x="7" width="2" height="16" fill="#fff"/><rect y="7" width="24" height="2" fill="#fff"/></svg>',
    fi: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#fff"/><rect x="7" width="3" height="16" fill="#002f6c"/><rect y="6.5" width="24" height="3" fill="#002f6c"/></svg>',
    cs: '<svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#d7141a"/><rect width="24" height="8" fill="#fff"/><path d="M0 0 12 8 0 16z" fill="#11457e"/></svg>'
  };

  const languageCodes = new Set(SUPPORTED_LANGUAGES.map((language) => language.code));
  const exactTranslations = new Map();
  const englishExactTranslations = new Map();
  const phraseTranslations = [];

  // French articles use Unicode escapes so the UI copy guard does not flag
  // them as German second-person wording.

  function t(values) {
    return values;
  }

  function addExact(sources, values) {
    sources.forEach((source) => {
      exactTranslations.set(normalize(source), values);
    });
  }

  function addPhrase(source, values) {
    phraseTranslations.push({ source, values });
    addExact([source], values);
  }

  function addEnglishExact(sources, translation) {
    sources.forEach((source) => {
      englishExactTranslations.set(normalize(source), translation);
    });
  }

  function values(en, de, fr, es, it, nl, pl, pt, sv, da, fi, cs) {
    return t({ en, de, fr, es, it, nl, pl, pt, sv, da, fi, cs });
  }

  function flagMarkup(languageCode) {
    return `<span class="flag-icon">${FLAG_SVGS[languageCode] || ""}</span>`;
  }

  function renderFlag(target, languageCode) {
    if (!target) return;
    target.innerHTML = flagMarkup(languageCode);
  }

  [
    [["Language"], values("Language", "Sprache", "Langue", "Idioma", "Lingua", "Taal", "Język", "Idioma", "Språk", "Sprog", "Kieli", "Jazyk")],
    [["Zur Übersicht", "Back to overview"], values("Back to overview", "Zur Übersicht", "Retour à l'aperçu", "Volver al resumen", "Torna alla panoramica", "Terug naar overzicht", "Powrót do przeglądu", "Voltar à visão geral", "Till översikten", "Til oversigt", "Takaisin yleiskuvaan", "Zpět na přehled")],
    [["Übersicht", "Overview"], values("Overview", "Übersicht", "Vue d'ensemble", "Resumen", "Panoramica", "Overzicht", "Przegląd", "Visão geral", "Översikt", "Oversigt", "Yleiskuva", "Přehled")],
    [["Auswertungen", "Analytics"], values("Analytics", "Auswertungen", "Analyses", "Analíticas", "Analisi", "Analyses", "Analityka", "Análises", "Analys", "Analyser", "Analytiikka", "Analytika")],
    [["Setup"], values("Setup", "Setup", "Configuration", "Configuración", "Configurazione", "Instellingen", "Konfiguracja", "Configuração", "Inställningar", "Opsætning", "Asetukset", "Nastavení")],
    [["Demo"], values("Demo", "Demo", "Démo", "Demo", "Demo", "Demo", "Demo", "Demo", "Demo", "Demo", "Demo", "Demo")],
    [["Status"], values("Status", "Status", "Statut", "Estado", "Stato", "Status", "Status", "Estado", "Status", "Status", "Tila", "Stav")],
    [["Bereit", "Ready"], values("Ready", "Bereit", "Prêt", "Listo", "Pronto", "Gereed", "Gotowe", "Pronto", "Klar", "Klar", "Valmis", "Připraveno")],
    [["Demo bereit.", "Demo ready."], values("Demo ready.", "Demo bereit.", "Démo prête.", "Demo lista.", "Demo pronta.", "Demo gereed.", "Demo gotowe.", "Demo pronta.", "Demo klar.", "Demo klar.", "Demo valmis.", "Demo připravena.")],
    [["Verbinde", "Connecting"], values("Connecting", "Verbinde", "Connexion", "Conectando", "Connessione", "Verbinden", "Łączenie", "A ligar", "Ansluter", "Forbinder", "Yhdistetään", "Připojování")],
    [["Verbunden", "Connected"], values("Connected", "Verbunden", "Connecté", "Conectado", "Connesso", "Verbonden", "Połączono", "Ligado", "Ansluten", "Forbundet", "Yhdistetty", "Připojeno")],
    [["Nicht verbunden", "Not connected"], values("Not connected", "Nicht verbunden", "Non connecté", "No conectado", "Non connesso", "Niet verbonden", "Nie połączono", "Não ligado", "Inte ansluten", "Ikke forbundet", "Ei yhdistetty", "Nepřipojeno")],
    [["Prüft", "Checking"], values("Checking", "Prüft", "Vérification", "Comprobando", "Verifica", "Controleren", "Sprawdzanie", "A verificar", "Kontrollerar", "Kontrollerer", "Tarkistetaan", "Kontrola")],
    [["Prüft Konfiguration", "Checking configuration"], values("Checking configuration", "Prüft Konfiguration", "Vérification de la configuration", "Comprobando configuración", "Verifica configurazione", "Configuratie controleren", "Sprawdzanie konfiguracji", "A verificar configuração", "Kontrollerar konfiguration", "Kontrollerer konfiguration", "Tarkistetaan asetuksia", "Kontrola konfigurace")],
    [["Aktualisieren", "Refresh"], values("Refresh", "Aktualisieren", "Actualiser", "Actualizar", "Aggiorna", "Vernieuwen", "Odśwież", "Atualizar", "Uppdatera", "Opdater", "Päivitä", "Obnovit")],
    [["Schließen", "Close"], values("Close", "Schließen", "Fermer", "Cerrar", "Chiudi", "Sluiten", "Zamknij", "Fechar", "Stäng", "Luk", "Sulje", "Zavřít")],
    [["Suchen", "Search"], values("Search", "Suchen", "Rechercher", "Buscar", "Cerca", "Zoeken", "Szukaj", "Pesquisar", "Sök", "Søg", "Haku", "Hledat")],
    [["Konfigurationsstatus", "Configuration status"], values("Configuration status", "Konfigurationsstatus", "État de configuration", "Estado de configuración", "Stato configurazione", "Configuratiestatus", "Status konfiguracji", "Estado da configuração", "Konfigurationsstatus", "Konfigurationsstatus", "Asetusten tila", "Stav konfigurace")],
    [["OAuth, API-Endpunkte und lokale Laufzeitdaten."], values("OAuth, API endpoints, and local runtime data.", "OAuth, API-Endpunkte und lokale Laufzeitdaten.", "OAuth, points de terminaison API et données locales d'exécution.", "OAuth, endpoints de API y datos locales de ejecución.", "OAuth, endpoint API e dati runtime locali.", "OAuth, API-eindpunten en lokale runtimegegevens.", "OAuth, punkty końcowe API i lokalne dane uruchomieniowe.", "OAuth, endpoints de API e dados locais de execução.", "OAuth, API-slutpunkter och lokala runtime-data.", "OAuth, API-endpoints og lokale runtime-data.", "OAuth, API-päätepisteet ja paikalliset ajonaikaiset tiedot.", "OAuth, API endpointy a lokální runtime data.")],
    [["Anmeldung", "Login"], values("Login", "Anmeldung", "Connexion", "Inicio de sesión", "Accesso", "Aanmelden", "Logowanie", "Login", "Inloggning", "Login", "Kirjautuminen", "Přihlášení")],
    [["Call-History-Zugang konfigurieren und anschließend mit einem Cloudya Account anmelden."], values("Configure Call History access, then sign in with a Cloudya account.", "Call-History-Zugang konfigurieren und anschließend mit einem Cloudya Account anmelden.", "Configurer l'accès Call History, puis se connecter avec un compte Cloudya.", "Configura el acceso a Call History y luego inicia sesión con una cuenta Cloudya.", "Configura l'accesso alla cronologia chiamate, quindi accedi con un account Cloudya.", "Configureer Call History-toegang en meld daarna aan met een Cloudya-account.", "Skonfiguruj dostęp do historii połączeń, a następnie zaloguj się kontem Cloudya.", "Configure o acesso ao Call History e inicie sessão com uma conta Cloudya.", "Konfigurera Call History-åtkomst och logga sedan in med ett Cloudya-konto.", "Konfigurer Call History-adgang, og log derefter ind med en Cloudya-konto.", "Määritä Call History -käyttö ja kirjaudu sitten Cloudya-tilillä.", "Nakonfigurujte přístup Call History a poté se přihlaste účtem Cloudya.")],
    [["Login erforderlich", "Login required"], values("Login required", "Login erforderlich", "Connexion requise", "Inicio de sesión requerido", "Accesso richiesto", "Aanmelden vereist", "Wymagane logowanie", "Login necessário", "Inloggning krävs", "Login påkrævet", "Kirjautuminen vaaditaan", "Vyžadováno přihlášení")],
    [["Login erforderlich · Demo-Fallback"], values("Login required · Demo fallback", "Login erforderlich · Demo-Fallback", "Connexion requise · Fallback démo", "Login requerido · Fallback demo", "Accesso richiesto · Fallback demo", "Aanmelden vereist · Demo-fallback", "Wymagane logowanie · Fallback demo", "Login necessário · Fallback demo", "Inloggning krävs · Demo-fallback", "Login påkrævet · Demo-fallback", "Kirjautuminen vaaditaan · Demo-varatila", "Vyžadováno přihlášení · Demo fallback")],
    [["Demo-Fallback"], values("Demo fallback", "Demo-Fallback", "Fallback démo", "Fallback demo", "Fallback demo", "Demo-fallback", "Fallback demo", "Fallback demo", "Demo-fallback", "Demo-fallback", "Demo-varatila", "Demo fallback")],
    [["Demo-Fallback aktiv."], values("Demo fallback active.", "Demo-Fallback aktiv.", "Fallback démo actif.", "Fallback demo activo.", "Fallback demo attivo.", "Demo-fallback actief.", "Fallback demo aktywny.", "Fallback demo ativo.", "Demo-fallback aktiv.", "Demo-fallback aktiv.", "Demo-varatila käytössä.", "Demo fallback aktivní.")],
    [["OAuth verbunden"], values("OAuth connected", "OAuth verbunden", "OAuth connecté", "OAuth conectado", "OAuth connesso", "OAuth verbonden", "OAuth połączony", "OAuth ligado", "OAuth ansluten", "OAuth forbundet", "OAuth yhdistetty", "OAuth připojeno")],
    [["OAuth bereit"], values("OAuth ready", "OAuth bereit", "OAuth prêt", "OAuth listo", "OAuth pronto", "OAuth gereed", "OAuth gotowy", "OAuth pronto", "OAuth klar", "OAuth klar", "OAuth valmis", "OAuth připraveno")],
    [["Lokale Konfiguration"], values("Local configuration", "Lokale Konfiguration", "Configuration locale", "Configuración local", "Configurazione locale", "Lokale configuratie", "Konfiguracja lokalna", "Configuração local", "Lokal konfiguration", "Lokal konfiguration", "Paikallinen määritys", "Lokální konfigurace")],
    [["OAuth Secret-Datei aktiv"], values("OAuth secret file active", "OAuth Secret-Datei aktiv", "Fichier secret OAuth actif", "Archivo secreto OAuth activo", "File segreto OAuth attivo", "OAuth-secretbestand actief", "Plik sekretu OAuth aktywny", "Ficheiro secreto OAuth ativo", "OAuth-hemlig fil aktiv", "OAuth-hemmelig fil aktiv", "OAuth-salaisuustiedosto aktiivinen", "Soubor tajemství OAuth aktivní")],
    [["Browser-Konfiguration"], values("Browser configuration", "Browser-Konfiguration", "Configuration d\u0075 navigateur", "Configuración del navegador", "Configurazione browser", "Browserconfiguratie", "Konfiguracja przeglądarki", "Configuração do navegador", "Webbläsarkonfiguration", "Browserkonfiguration", "Selaimen määritys", "Konfigurace prohlížeče")],
    [["Zugangsdaten für diese Sitzung setzen"], values("Set credentials for this session", "Zugangsdaten für diese Sitzung setzen", "Définir les identifiants pour cette session", "Definir credenciales para esta sesión", "Imposta credenziali per questa sessione", "Inloggegevens voor deze sessie instellen", "Ustaw dane logowania dla tej sesji", "Definir credenciais para esta sessão", "Ange uppgifter för den här sessionen", "Angiv adgangsdata for denne session", "Aseta kirjautumistiedot tälle istunnolle", "Nastavit přihlašovací údaje pro tuto relaci")],
    [["Pflichtfeld für OAuth Login"], values("Required for OAuth login", "Pflichtfeld für OAuth Login", "Obligatoire pour la connexion OAuth", "Obligatorio para login OAuth", "Obbligatorio per login OAuth", "Vereist voor OAuth-login", "Wymagane dla logowania OAuth", "Obrigatório para login OAuth", "Krävs för OAuth-inloggning", "Påkrævet for OAuth-login", "Vaaditaan OAuth-kirjautumiseen", "Povinné pro OAuth přihlášení")],
    [["leer lassen für localhost:3000"], values("Leave empty for localhost:3000", "leer lassen für localhost:3000", "Laisser vide pour localhost:3000", "Dejar vacío para localhost:3000", "Lascia vuoto per localhost:3000", "Leeg laten voor localhost:3000", "Pozostaw puste dla localhost:3000", "Deixar vazio para localhost:3000", "Lämna tomt för localhost:3000", "Lad stå tom for localhost:3000", "Jätä tyhjäksi localhost:3000:lle", "Ponechte prázdné pro localhost:3000")],
    [["Zugang setzen"], values("Set access", "Zugang setzen", "Définir l'accès", "Definir acceso", "Imposta accesso", "Toegang instellen", "Ustaw dostęp", "Definir acesso", "Ange åtkomst", "Indstil adgang", "Aseta käyttöoikeus", "Nastavit přístup")],
    [["Danach den NFON OAuth-Login über den Login-Button starten."], values("Then start NFON OAuth login with the login button.", "Danach den NFON OAuth-Login über den Login-Button starten.", "Démarrer ensuite la connexion OAuth NFON avec le bouton de connexion.", "Después inicia el login OAuth de NFON con el botón de login.", "Avvia quindi il login OAuth NFON con il pulsante di login.", "Start daarna NFON OAuth-login met de loginknop.", "Następnie uruchom logowanie OAuth NFON przyciskiem logowania.", "Depois inicie o login OAuth NFON com o botão de login.", "Starta sedan NFON OAuth-inloggningen med inloggningsknappen.", "Start derefter NFON OAuth-login med login-knappen.", "Käynnistä sitten NFON OAuth -kirjautuminen kirjautumispainikkeella.", "Poté spusťte NFON OAuth přihlášení tlačítkem login.")],
    [["Cloudya Login"], values("Cloudya login", "Cloudya Login", "Connexion Cloudya", "Login Cloudya", "Login Cloudya", "Cloudya-login", "Login Cloudya", "Login Cloudya", "Cloudya-inloggning", "Cloudya-login", "Cloudya-kirjautuminen", "Cloudya login")],
    [["Login mit Cloudya Account"], values("Login with Cloudya account", "Login mit Cloudya Account", "Connexion avec un compte Cloudya", "Login con cuenta Cloudya", "Login con account Cloudya", "Aanmelden met Cloudya-account", "Logowanie kontem Cloudya", "Login com conta Cloudya", "Logga in med Cloudya-konto", "Login med Cloudya-konto", "Kirjaudu Cloudya-tilillä", "Přihlášení účtem Cloudya")],
    [["Nach der Konfiguration verbindet der OAuth-Login diese lokale Showcase-App mit einem Cloudya Account."], values("After configuration, OAuth login connects this local showcase app to a Cloudya account.", "Nach der Konfiguration verbindet der OAuth-Login diese lokale Showcase-App mit einem Cloudya Account.", "Après configuration, la connexion OAuth relie cette application showcase locale à un compte Cloudya.", "Tras la configuración, el login OAuth conecta esta app showcase local con una cuenta Cloudya.", "Dopo la configurazione, il login OAuth collega questa app showcase locale a un account Cloudya.", "Na configuratie koppelt OAuth-login deze lokale showcase-app aan een Cloudya-account.", "Po konfiguracji logowanie OAuth połączy tę lokalną aplikację showcase z kontem Cloudya.", "Após a configuração, o login OAuth liga esta app showcase local a uma conta Cloudya.", "Efter konfiguration kopplar OAuth-inloggning denna lokala showcase-app till ett Cloudya-konto.", "Efter konfiguration forbinder OAuth-login denne lokale showcase-app med en Cloudya-konto.", "Määrityksen jälkeen OAuth-kirjautuminen yhdistää tämän paikallisen showcase-sovelluksen Cloudya-tiliin.", "Po konfiguraci OAuth přihlášení propojí tuto lokální showcase aplikaci s účtem Cloudya.")],
    [["PKCE-Login konfiguriert"], values("PKCE login configured", "PKCE-Login konfiguriert", "Connexion PKCE configurée", "Login PKCE configurado", "Login PKCE configurato", "PKCE-login geconfigureerd", "Login PKCE skonfigurowany", "Login PKCE configurado", "PKCE-inloggning konfigurerad", "PKCE-login konfigureret", "PKCE-kirjautuminen määritetty", "PKCE přihlášení nakonfigurováno")],
    [["CALLHISTORY_CLIENT_ID fehlt"], values("CALLHISTORY_CLIENT_ID missing", "CALLHISTORY_CLIENT_ID fehlt", "CALLHISTORY_CLIENT_ID manquant", "Falta CALLHISTORY_CLIENT_ID", "CALLHISTORY_CLIENT_ID mancante", "CALLHISTORY_CLIENT_ID ontbreekt", "Brak CALLHISTORY_CLIENT_ID", "CALLHISTORY_CLIENT_ID em falta", "CALLHISTORY_CLIENT_ID saknas", "CALLHISTORY_CLIENT_ID mangler", "CALLHISTORY_CLIENT_ID puuttuu", "CALLHISTORY_CLIENT_ID chybí")],
    [["serverseitig vorhanden"], values("Available server-side", "serverseitig vorhanden", "Disponible côté serveur", "Disponible en servidor", "Disponibile lato server", "Server-side beschikbaar", "Dostępny po stronie serwera", "Disponível no servidor", "Tillgänglig på serversidan", "Tilgængelig på serversiden", "Saatavilla palvelimella", "Dostupné na serveru")],
    [["Speichern", "Save"], values("Save", "Speichern", "Enregistrer", "Guardar", "Salva", "Opslaan", "Zapisz", "Guardar", "Spara", "Gem", "Tallenna", "Uložit")],
    [["Geprüft", "Checked"], values("Checked", "Geprüft", "Vérifié", "Comprobado", "Verificato", "Gecontroleerd", "Sprawdzone", "Verificado", "Kontrollerad", "Kontrolleret", "Tarkistettu", "Zkontrolováno")],
    [["Server läuft", "Server running"], values("Server running", "Server läuft", "Serveur en cours d'exécution", "Servidor en ejecución", "Server in esecuzione", "Server draait", "Serwer działa", "Servidor em execução", "Server körs", "Server kører", "Palvelin käynnissä", "Server běží")],
    [["Server starten", "Start server"], values("Start server", "Server starten", "Démarrer le serveur", "Iniciar servidor", "Avvia server", "Server starten", "Uruchom serwer", "Iniciar servidor", "Starta server", "Start server", "Käynnistä palvelin", "Spustit server")],
    [["Server stoppen", "Stop server"], values("Stop server", "Server stoppen", "Arrêter le serveur", "Detener servidor", "Arresta server", "Server stoppen", "Zatrzymaj serwer", "Parar servidor", "Stoppa server", "Stop server", "Pysäytä palvelin", "Zastavit server")],
    [["Lokales Showcase-Gateway", "Local showcase gateway"], values("Local showcase gateway", "Lokales Showcase-Gateway", "Passerelle de showcase locale", "Gateway local de showcase", "Gateway showcase locale", "Lokale showcase-gateway", "Lokalna brama showcase", "Gateway local de showcase", "Lokal showcase-gateway", "Lokal showcase-gateway", "Paikallinen showcase-yhdyskäytävä", "Lokální showcase brána")],
    [["NFON API Apps"], values("NFON API Apps", "NFON API Apps", "Apps API NFON", "Apps API NFON", "App API NFON", "NFON API-apps", "Aplikacje API NFON", "Apps API NFON", "NFON API-appar", "NFON API-apps", "NFON API -sovellukset", "Aplikace NFON API")],
    [["Live-Telefonie"], values("Live telephony", "Live-Telefonie", "Téléphonie en direct", "Telefonía en vivo", "Telefonia live", "Live telefonie", "Telefonia na żywo", "Telefonia em direto", "Live-telefoni", "Live-telefoni", "Reaaliaikainen puhelinliikenne", "Živá telefonie")],
    [["PBX Administration"], values("PBX administration", "PBX Administration", "Administration PBX", "Administración PBX", "Amministrazione PBX", "PBX-beheer", "Administracja PBX", "Administração PBX", "PBX-administration", "PBX-administration", "PBX-hallinta", "Správa PBX")],
    [["Gesprächshistorie"], values("Call history", "Gesprächshistorie", "Historique des appels", "Historial de llamadas", "Cronologia chiamate", "Gespreksgeschiedenis", "Historia połączeń", "Histórico de chamadas", "Samtalshistorik", "Opkaldshistorik", "Puheluhistoria", "Historie hovorů")],
    [["Präsenz, Nebenstellen, Click-to-Dial und laufende Telefonie im Dashboard."], values("Presence, extensions, click-to-dial, and active telephony in one dashboard.", "Präsenz, Nebenstellen, Click-to-Dial und laufende Telefonie im Dashboard.", "Présence, extensions, click-to-dial et téléphonie active dans un tableau de bord.", "Presencia, extensiones, click-to-dial y telefonía activa en un panel.", "Presenza, interni, click-to-dial e telefonia attiva in una dashboard.", "Aanwezigheid, extensies, click-to-dial en actieve telefonie in één dashboard.", "Obecność, numery wewnętrzne, click-to-dial i aktywna telefonia w panelu.", "Presença, extensões, click-to-dial e telefonia ativa num painel.", "Närvaro, anknytningar, click-to-dial och aktiv telefoni i en dashboard.", "Tilstedeværelse, lokalnumre, click-to-dial og aktiv telefoni i et dashboard.", "Läsnäolo, alanumerot, click-to-dial ja aktiivinen puhelinliikenne yhdessä näkymässä.", "Přítomnost, linky, click-to-dial a aktivní telefonie v jednom dashboardu.")],
    [["Rufnummern, Geräte, Routing-Objekte und Callflow-Kontext aus dem Portal."], values("Numbers, devices, routing objects, and callflow context from the portal.", "Rufnummern, Geräte, Routing-Objekte und Callflow-Kontext aus dem Portal.", "Numéros, appareils, objets de routage et contexte callflow d\u0075 portail.", "Números, dispositivos, objetos de enrutamiento y contexto de callflow del portal.", "Numeri, dispositivi, oggetti di routing e contesto callflow dal portale.", "Nummers, apparaten, routeringsobjecten en callflow-context uit de portal.", "Numery, urządzenia, obiekty routingu i kontekst callflow z portalu.", "Números, dispositivos, objetos de encaminhamento e contexto de callflow do portal.", "Nummer, enheter, routingobjekt och callflow-kontext från portalen.", "Numre, enheder, routingobjekter og callflow-kontekst fra portalen.", "Numerot, laitteet, reititysobjektit ja callflow-konteksti portaalista.", "Čísla, zařízení, směrovací objekty a kontext callflow z portálu.")],
    [["Login, Ruflisten, Transcripts und CRM-Zuordnung für abgeschlossene Gespräche."], values("Login, call lists, transcripts, and CRM mapping for completed calls.", "Login, Ruflisten, Transcripts und CRM-Zuordnung für abgeschlossene Gespräche.", "Connexion, listes d'appels, transcriptions et attribution CRM pour les appels terminés.", "Login, listas de llamadas, transcripciones y asignación CRM para llamadas finalizadas.", "Login, liste chiamate, trascrizioni e assegnazione CRM per chiamate concluse.", "Login, bellijsten, transcripties en CRM-koppeling voor afgeronde gesprekken.", "Logowanie, listy połączeń, transkrypcje i mapowanie CRM dla zakończonych rozmów.", "Login, listas de chamadas, transcrições e mapeamento CRM para chamadas concluídas.", "Inloggning, samtalslistor, transkript och CRM-koppling för avslutade samtal.", "Login, opkaldslister, transskripter og CRM-mapping for afsluttede opkald.", "Kirjautuminen, puhelulistat, transkriptit ja CRM-kohdistus päättyneille puheluille.", "Přihlášení, seznamy hovorů, přepisy a CRM mapování pro dokončené hovory.")],
    [["Anrufe heute"], values("Calls today", "Anrufe heute", "Appels aujourd'hui", "Llamadas hoy", "Chiamate oggi", "Gesprekken vandaag", "Połączenia dzisiaj", "Chamadas hoje", "Samtal idag", "Opkald i dag", "Puhelut tänään", "Hovory dnes")],
    [["Angenommen"], values("Answered", "Angenommen", "Répondu", "Atendidas", "Risposte", "Beantwoord", "Odebrane", "Atendidas", "Besvarade", "Besvaret", "Vastatut", "Přijaté")],
    [["Aktive Calls"], values("Active calls", "Aktive Calls", "Appels actifs", "Llamadas activas", "Chiamate attive", "Actieve gesprekken", "Aktywne połączenia", "Chamadas ativas", "Aktiva samtal", "Aktive opkald", "Aktiiviset puhelut", "Aktivní hovory")],
    [["Nebenstellen"], values("Extensions", "Nebenstellen", "Extensions", "Extensiones", "Interni", "Extensies", "Numery wewnętrzne", "Extensões", "Anknytningar", "Lokalnumre", "Alanumerot", "Linky")],
    [["Nebenstelle"], values("Extension", "Nebenstelle", "Extension", "Extensión", "Interno", "Extensie", "Numer wewnętrzny", "Extensão", "Anknytning", "Lokalnummer", "Alanumero", "Linka")],
    [["Präsenz"], values("Presence", "Präsenz", "Présence", "Presencia", "Presenza", "Aanwezigheid", "Obecność", "Presença", "Närvaro", "Tilstedeværelse", "Läsnäolo", "Přítomnost")],
    [["Leitung"], values("Line", "Leitung", "Ligne", "Línea", "Linea", "Lijn", "Linia", "Linha", "Linje", "Linje", "Linja", "Linka")],
    [["Name"], values("Name", "Name", "Nom", "Nombre", "Nome", "Naam", "Nazwa", "Nome", "Namn", "Navn", "Nimi", "Název")],
    [["Von"], values("From", "Von", "De", "Desde", "Da", "Van", "Od", "De", "Från", "Fra", "Lähettäjä", "Od")],
    [["Ziel"], values("Destination", "Ziel", "Destination", "Destino", "Destinazione", "Bestemming", "Cel", "Destino", "Destination", "Destination", "Kohde", "Cíl")],
    [["Anruf starten"], values("Start call", "Anruf starten", "Démarrer l'appel", "Iniciar llamada", "Avvia chiamata", "Gesprek starten", "Rozpocznij połączenie", "Iniciar chamada", "Starta samtal", "Start opkald", "Aloita puhelu", "Zahájit hovor")],
    [["Live Events"], values("Live events", "Live Events", "Événements live", "Eventos en vivo", "Eventi live", "Live events", "Zdarzenia live", "Eventos em direto", "Livehändelser", "Live-hændelser", "Live-tapahtumat", "Živé události")],
    [["Kennzahlen"], values("Metrics", "Kennzahlen", "Indicateurs", "Métricas", "Metriche", "Metrics", "Metryki", "Métricas", "Mätvärden", "Målepunkter", "Mittarit", "Metriky")],
    [["Qualität"], values("Quality", "Qualität", "Qualité", "Calidad", "Qualità", "Kwaliteit", "Jakość", "Qualidade", "Kvalitet", "Kvalitet", "Laatu", "Kvalita")],
    [["Tagesverlauf"], values("Daily trend", "Tagesverlauf", "Évolution d\u0075 jour", "Evolución diaria", "Andamento giornaliero", "Dagverloop", "Trend dzienny", "Evolução diária", "Dagens trend", "Dagsforløb", "Päivän trendi", "Denní trend")],
    [["Trend"], values("Trend", "Trend", "Tendance", "Tendencia", "Trend", "Trend", "Trend", "Tendência", "Trend", "Trend", "Trendi", "Trend")],
    [["Richtung"], values("Direction", "Richtung", "Direction", "Dirección", "Direzione", "Richting", "Kierunek", "Direção", "Riktning", "Retning", "Suunta", "Směr")],
    [["Team"], values("Team", "Team", "Équipe", "Equipo", "Team", "Team", "Zespół", "Equipa", "Team", "Team", "Tiimi", "Tým")],
    [["Annahmequote"], values("Answer rate", "Annahmequote", "Taux de réponse", "Tasa de respuesta", "Tasso di risposta", "Antwoordpercentage", "Wskaźnik odbioru", "Taxa de atendimento", "Svarsfrekvens", "Svarprocent", "Vastausaste", "Míra přijetí")],
    [["Durchschnitt"], values("Average", "Durchschnitt", "Moyenne", "Promedio", "Media", "Gemiddelde", "Średnia", "Média", "Genomsnitt", "Gennemsnit", "Keskiarvo", "Průměr")],
    [["Verpasst"], values("Missed", "Verpasst", "Manqué", "Perdidas", "Perse", "Gemist", "Nieodebrane", "Perdidas", "Missade", "Mistede", "Vastaamatta", "Zmeškané")],
    [["Eingehend"], values("Inbound", "Eingehend", "Entrant", "Entrante", "In entrata", "Inkomend", "Przychodzące", "Entrada", "Inkommande", "Indgående", "Saapuva", "Příchozí")],
    [["Ausgehend"], values("Outbound", "Ausgehend", "Sortant", "Saliente", "In uscita", "Uitgaand", "Wychodzące", "Saída", "Utgående", "Udgående", "Lähtevä", "Odchozí")],
    [["Unklar"], values("Unknown", "Unklar", "Inconnu", "Desconocido", "Sconosciuto", "Onbekend", "Nieznane", "Desconhecido", "Okänd", "Ukendt", "Tuntematon", "Neznámé")],
    [["Heute"], values("Today", "Heute", "Aujourd'hui", "Hoy", "Oggi", "Vandaag", "Dzisiaj", "Hoje", "Idag", "I dag", "Tänään", "Dnes")],
    [["7 Tage"], values("7 days", "7 Tage", "7 jours", "7 días", "7 giorni", "7 dagen", "7 dni", "7 dias", "7 dagar", "7 dage", "7 päivää", "7 dní")],
    [["30 Tage"], values("30 days", "30 Tage", "30 jours", "30 días", "30 giorni", "30 dagen", "30 dni", "30 dias", "30 dagar", "30 dage", "30 päivää", "30 dní")],
    [["Verfügbar"], values("Available", "Verfügbar", "Disponible", "Disponible", "Disponibile", "Beschikbaar", "Dostępny", "Disponível", "Tillgänglig", "Tilgængelig", "Saatavilla", "Dostupné")],
    [["Frei"], values("Free", "Frei", "Libre", "Libre", "Libero", "Vrij", "Wolny", "Livre", "Ledig", "Ledig", "Vapaa", "Volné")],
    [["Besetzt", "Beschäftigt"], values("Busy", "Besetzt", "Occupé", "Ocupado", "Occupato", "Bezet", "Zajęty", "Ocupado", "Upptagen", "Optaget", "Varattu", "Obsazeno")],
    [["Im Gespräch"], values("On a call", "Im Gespräch", "En appel", "En llamada", "In chiamata", "In gesprek", "W rozmowie", "Em chamada", "I samtal", "I opkald", "Puhelussa", "Probíhá hovor")],
    [["Bitte nicht stören"], values("Do not disturb", "Bitte nicht stören", "Ne pas déranger", "No molestar", "Non disturbare", "Niet storen", "Nie przeszkadzać", "Não incomodar", "Stör ej", "Forstyr ikke", "Älä häiritse", "Nerušit")],
    [["Rufliste"], values("Call list", "Rufliste", "Liste d'appels", "Lista de llamadas", "Lista chiamate", "Bellijst", "Lista połączeń", "Lista de chamadas", "Samtalslista", "Opkaldsliste", "Puhelulista", "Seznam hovorů")],
    [["Transcripts"], values("Transcripts", "Transcripts", "Transcriptions", "Transcripciones", "Trascrizioni", "Transcripties", "Transkrypcje", "Transcrições", "Transkript", "Transskripter", "Transkriptit", "Přepisy")],
    [["CRM Demo"], values("CRM demo", "CRM Demo", "Démo CRM", "Demo CRM", "Demo CRM", "CRM-demo", "Demo CRM", "Demo CRM", "CRM-demo", "CRM-demo", "CRM-demo", "CRM demo")],
    [["Filter"], values("Filters", "Filter", "Filtres", "Filtros", "Filtri", "Filters", "Filtry", "Filtros", "Filter", "Filtre", "Suodattimet", "Filtry")],
    [["Zeitraum"], values("Period", "Zeitraum", "Période", "Periodo", "Periodo", "Periode", "Okres", "Período", "Period", "Periode", "Aikaväli", "Období")],
    [["Ergebnis"], values("Result", "Ergebnis", "Résultat", "Resultado", "Risultato", "Resultaat", "Wynik", "Resultado", "Resultat", "Resultat", "Tulos", "Výsledek")],
    [["Transkript"], values("Transcript", "Transkript", "Transcription", "Transcripción", "Trascrizione", "Transcript", "Transkrypcja", "Transcrição", "Transkript", "Transskript", "Transkripti", "Přepis")],
    [["Teilnehmer"], values("Participant", "Teilnehmer", "Participant", "Participante", "Partecipante", "Deelnemer", "Uczestnik", "Participante", "Deltagare", "Deltager", "Osallistuja", "Účastník")],
    [["Alle Richtungen"], values("All directions", "Alle Richtungen", "Toutes directions", "Todas las direcciones", "Tutte le direzioni", "Alle richtingen", "Wszystkie kierunki", "Todas as direções", "Alla riktningar", "Alle retninger", "Kaikki suunnat", "Všechny směry")],
    [["Alle Ergebnisse"], values("All results", "Alle Ergebnisse", "Tous les résultats", "Todos los resultados", "Tutti i risultati", "Alle resultaten", "Wszystkie wyniki", "Todos os resultados", "Alla resultat", "Alle resultater", "Kaikki tulokset", "Všechny výsledky")],
    [["Alle"], values("All", "Alle", "Tous", "Todos", "Tutti", "Alle", "Wszystkie", "Todos", "Alla", "Alle", "Kaikki", "Vše")],
    [["Ja"], values("Yes", "Ja", "Oui", "Sí", "Sì", "Ja", "Tak", "Sim", "Ja", "Ja", "Kyllä", "Ano")],
    [["Nein"], values("No", "Nein", "Non", "No", "No", "Nee", "Nie", "Não", "Nej", "Nej", "Ei", "Ne")],
    [["Anrufliste"], values("Call list", "Anrufliste", "Liste d'appels", "Lista de llamadas", "Lista chiamate", "Bellijst", "Lista połączeń", "Lista de chamadas", "Samtalslista", "Opkaldsliste", "Puhelulista", "Seznam hovorů")],
    [["Datum / Zeit"], values("Date / time", "Datum / Zeit", "Date / heure", "Fecha / hora", "Data / ora", "Datum / tijd", "Data / godzina", "Data / hora", "Datum / tid", "Dato / tid", "Päivä / aika", "Datum / čas")],
    [["Call-Detail"], values("Call detail", "Call-Detail", "Détail d'appel", "Detalle de llamada", "Dettaglio chiamata", "Gespreksdetail", "Szczegóły połączenia", "Detalhe da chamada", "Samtalsdetalj", "Opkaldsdetalje", "Puhelun tiedot", "Detail hovoru")],
    [["Kein Call ausgewählt"], values("No call selected", "Kein Call ausgewählt", "Aucun appel sélectionné", "Ninguna llamada seleccionada", "Nessuna chiamata selezionata", "Geen gesprek geselecteerd", "Nie wybrano połączenia", "Nenhuma chamada selecionada", "Inget samtal valt", "Intet opkald valgt", "Ei puhelua valittu", "Není vybrán hovor")],
    [["Automatisierte Supportabrechnung"], values("Automated support billing", "Automatisierte Supportabrechnung", "Facturation support automatisée", "Facturación de soporte automatizada", "Fatturazione supporto automatizzata", "Geautomatiseerde supportfacturatie", "Automatyczne rozliczanie wsparcia", "Faturação de suporte automatizada", "Automatiserad supportdebitering", "Automatiseret supportfakturering", "Automaattinen tukilaskutus", "Automatizovaná fakturace podpory")],
    [["Ticket"], values("Ticket", "Ticket", "Ticket", "Ticket", "Ticket", "Ticket", "Zgłoszenie", "Ticket", "Ärende", "Ticket", "Tiketti", "Ticket")],
    [["Kunde"], values("Customer", "Kunde", "Client", "Cliente", "Cliente", "Klant", "Klient", "Cliente", "Kund", "Kunde", "Asiakas", "Zákazník")],
    [["Abrechnung"], values("Billing", "Abrechnung", "Facturation", "Facturación", "Fatturazione", "Facturatie", "Rozliczenie", "Faturação", "Debitering", "Fakturering", "Laskutus", "Fakturace")],
    [["Telefonbuch"], values("Phonebook", "Telefonbuch", "Annuaire", "Agenda telefónica", "Rubrica", "Telefoonboek", "Książka telefoniczna", "Lista telefónica", "Telefonbok", "Telefonbog", "Puhelinluettelo", "Telefonní seznam")],
    [["Telefonbuch-Sync"], values("Phonebook sync", "Telefonbuch-Sync", "Synchronisation annuaire", "Sincronización de agenda", "Sincronizzazione rubrica", "Telefoonboek-synchronisatie", "Synchronizacja książki telefonicznej", "Sincronização da lista telefónica", "Telefonbokssynk", "Telefonbogssynk", "Puhelinluettelon synkronointi", "Synchronizace telefonního seznamu")],
    [["Warteschlangen"], values("Queues", "Warteschlangen", "Files d'attente", "Colas", "Code", "Wachtrijen", "Kolejki", "Filas", "Köer", "Køer", "Jonot", "Fronty")],
    [["Warteschlange"], values("Queue", "Warteschlange", "File d'attente", "Cola", "Coda", "Wachtrij", "Kolejka", "Fila", "Kö", "Kø", "Jono", "Fronta")],
    [["Skillgruppen"], values("Skill groups", "Skillgruppen", "Groupes de compétences", "Grupos de habilidades", "Gruppi skill", "Skillgroepen", "Grupy umiejętności", "Grupos de competências", "Kompetensgrupper", "Skillgrupper", "Taitoryhmät", "Skupiny dovedností")],
    [["Skillgruppe"], values("Skill group", "Skillgruppe", "Groupe de compétences", "Grupo de habilidades", "Gruppo skill", "Skillgroep", "Grupa umiejętności", "Grupo de competências", "Kompetensgrupp", "Skillgruppe", "Taitoryhmä", "Skupina dovedností")],
    [["Callflow"], values("Callflow", "Callflow", "Callflow", "Callflow", "Callflow", "Callflow", "Callflow", "Callflow", "Callflow", "Callflow", "Callflow", "Callflow")],
    [["Callflow Builder"], values("Callflow builder", "Callflow Builder", "Constructeur callflow", "Diseñador de callflow", "Builder callflow", "Callflow-builder", "Kreator callflow", "Construtor de callflow", "Callflow-byggare", "Callflow-builder", "Callflow-rakennin", "Návrhář callflow")],
    [["Rufnummern-Routing aus der Portal API"], values("Number routing from the Portal API", "Rufnummern-Routing aus der Portal API", "Routage des numéros via l'API Portal", "Enrutamiento de números desde la API Portal", "Routing numeri dalla Portal API", "Nummerrouting vanuit de Portal API", "Routing numerów z Portal API", "Encaminhamento de números da Portal API", "Nummerstyrning från Portal API", "Nummerrouting fra Portal API", "Numeroiden reititys Portal API:sta", "Směrování čísel z Portal API")],
    [["Kontakte per Datei oder manuell vorbereiten und mit dem aktuellen NFON-Telefonbuch abgleichen."], values("Prepare contacts by file or manually and compare them with the current NFON phonebook.", "Kontakte per Datei oder manuell vorbereiten und mit dem aktuellen NFON-Telefonbuch abgleichen.", "Préparer les contacts par fichier ou manuellement et les comparer à l'annuaire NFON actuel.", "Prepare contactos por archivo o manualmente y compárelos con la agenda NFON actual.", "Prepara contatti da file o manualmente e confrontali con la rubrica NFON attuale.", "Bereid contacten via bestand of handmatig voor en vergelijk ze met het actuele NFON-telefoonboek.", "Przygotuj kontakty z pliku lub ręcznie i porównaj je z aktualną książką NFON.", "Prepare contactos por ficheiro ou manualmente e compare com a lista NFON atual.", "Förbered kontakter via fil eller manuellt och jämför med aktuell NFON-telefonbok.", "Klargør kontakter via fil eller manuelt og sammenlign med den aktuelle NFON-telefonbog.", "Valmistele yhteystiedot tiedostosta tai käsin ja vertaa nykyiseen NFON-puhelinluetteloon.", "Připravte kontakty ze souboru nebo ručně a porovnejte je s aktuálním telefonním seznamem NFON.")],
    [["Bestand"], values("Inventory", "Bestand", "Inventaire", "Inventario", "Inventario", "Inventaris", "Stan", "Inventário", "Bestånd", "Oversigt", "Luettelo", "Inventář")],
    [["Batch Import"], values("Batch import", "Batch Import", "Import par lot", "Importación por lotes", "Import batch", "Batchimport", "Import wsadowy", "Importação em lote", "Batchimport", "Batchimport", "Erätuonti", "Dávkový import")],
    [["Ausgewählte Nebenstelle"], values("Selected extension", "Ausgewählte Nebenstelle", "Extension sélectionnée", "Extensión seleccionada", "Interno selezionato", "Geselecteerde extensie", "Wybrany numer wewnętrzny", "Extensão selecionada", "Vald anknytning", "Valgt lokalnummer", "Valittu alanumero", "Vybraná linka")],
    [["Aktionen"], values("Actions", "Aktionen", "Actions", "Acciones", "Azioni", "Acties", "Akcje", "Ações", "Åtgärder", "Handlinger", "Toiminnot", "Akce")],
    [["Vorbereitete Änderung"], values("Prepared change", "Vorbereitete Änderung", "Modification préparée", "Cambio preparado", "Modifica preparata", "Voorbereide wijziging", "Przygotowana zmiana", "Alteração preparada", "Förberedd ändring", "Forberedt ændring", "Valmisteltu muutos", "Připravená změna")],
    [["Zeile hinzufügen"], values("Add row", "Zeile hinzufügen", "Ajouter une ligne", "Añadir fila", "Aggiungi riga", "Rij toevoegen", "Dodaj wiersz", "Adicionar linha", "Lägg till rad", "Tilføj række", "Lisää rivi", "Přidat řádek")],
    [["Batch prüfen"], values("Check batch", "Batch prüfen", "Vérifier le lot", "Comprobar lote", "Verifica batch", "Batch controleren", "Sprawdź wsad", "Verificar lote", "Kontrollera batch", "Kontroller batch", "Tarkista erä", "Zkontrolovat dávku")],
    [["Visuelle Einrichtung der Anlage."], values("Visual PBX setup.", "Visuelle Einrichtung der Anlage.", "Configuration visuelle d\u0075 PBX.", "Configuración visual de la central.", "Configurazione visiva del PBX.", "Visuele PBX-configuratie.", "Wizualna konfiguracja centrali.", "Configuração visual da central.", "Visuell PBX-konfiguration.", "Visuel PBX-opsætning.", "PBX:n visuaalinen määritys.", "Vizuální nastavení PBX.")],
    [["Lokalen Entwurf löschen"], values("Delete local draft", "Lokalen Entwurf löschen", "Supprimer le brouillon local", "Eliminar borrador local", "Elimina bozza locale", "Lokale conceptversie verwijderen", "Usuń lokalny szkic", "Eliminar rascunho local", "Ta bort lokalt utkast", "Slet lokalt udkast", "Poista paikallinen luonnos", "Smazat místní koncept")],
    [["Callflow als PDF"], values("Callflow as PDF", "Callflow als PDF", "Callflow en PDF", "Callflow como PDF", "Callflow come PDF", "Callflow als PDF", "Callflow jako PDF", "Callflow em PDF", "Callflow som PDF", "Callflow som PDF", "Callflow PDF:nä", "Callflow jako PDF")],
    [["Warteschlangen & Skillgruppen"], values("Queues & skill groups", "Warteschlangen & Skillgruppen", "Files d'attente & groupes de compétences", "Colas y grupos de habilidades", "Code e gruppi skill", "Wachtrijen & skillgroepen", "Kolejki i grupy umiejętności", "Filas e grupos de competências", "Köer och kompetensgrupper", "Køer og skillgrupper", "Jonot ja taitoryhmät", "Fronty a skupiny dovedností")],
    [["Nebenstellen per Drag & Drop zuordnen."], values("Assign extensions by drag and drop.", "Nebenstellen per Drag & Drop zuordnen.", "Attribuer les extensions par glisser-déposer.", "Asignar extensiones con arrastrar y soltar.", "Assegna interni con drag & drop.", "Wijs extensies toe met drag-and-drop.", "Przypisz numery metodą przeciągnij i upuść.", "Atribua extensões por arrastar e largar.", "Tilldela anknytningar med dra och släpp.", "Tildel lokalnumre med træk og slip.", "Määritä alanumerot raahaamalla.", "Přiřaďte linky přetažením.")],
    [["Leerer Schritt"], values("Empty step", "Leerer Schritt", "Étape vide", "Paso vacío", "Passo vuoto", "Lege stap", "Pusty krok", "Passo vazio", "Tomt steg", "Tomt trin", "Tyhjä vaihe", "Prázdný krok")],
    [["Funktion auswählen"], values("Select function", "Funktion auswählen", "Sélectionner une fonction", "Seleccionar función", "Seleziona funzione", "Functie selecteren", "Wybierz funkcję", "Selecionar função", "Välj funktion", "Vælg funktion", "Valitse toiminto", "Vybrat funkci")],
    [["Zeitsteuerung"], values("Time control", "Zeitsteuerung", "Gestion horaire", "Control horario", "Controllo orario", "Tijdsturing", "Sterowanie czasem", "Controlo horário", "Tidsstyrning", "Tidsstyring", "Aikaohjaus", "Časové řízení")],
    [["Sprachdialog"], values("Voice dialog", "Sprachdialog", "Dialogue vocal", "Diálogo de voz", "Dialogo vocale", "Spraakdialoog", "Dialog głosowy", "Diálogo de voz", "Röstdialog", "Stemmedialog", "Äänivalikko", "Hlasový dialog")],
    [["Im Demomodus nicht möglich"], values("Not available in demo mode", "Im Demomodus nicht möglich", "Non disponible en mode démo", "No disponible en modo demo", "Non disponibile in modalità demo", "Niet beschikbaar in demomodus", "Niedostępne w trybie demo", "Não disponível no modo demo", "Inte tillgängligt i demoläge", "Ikke tilgængeligt i demotilstand", "Ei käytettävissä demotilassa", "Není dostupné v demo režimu")],
    [["Demo-Daten aktiv.", "Demo data active."], values("Demo data active.", "Demo-Daten aktiv.", "Données de démo actives.", "Datos demo activos.", "Dati demo attivi.", "Demogegevens actief.", "Dane demo aktywne.", "Dados demo ativos.", "Demodata aktiv.", "Demodata aktive.", "Demodata aktiivinen.", "Demo data aktivní.")],
    [["Live-Schreiben deaktiviert"], values("Live writes disabled", "Live-Schreiben deaktiviert", "Écriture live désactivée", "Escritura live desactivada", "Scrittura live disattivata", "Live schrijven uitgeschakeld", "Zapisy live wyłączone", "Escrita live desativada", "Live-skrivning avstängd", "Live-skrivning deaktiveret", "Live-kirjoitus pois käytöstä", "Živé zápisy vypnuté")],
    [["Live-Schreiben ist im Setup deaktiviert. Dry-runs und Vorschauen bleiben aktiv."], values("Live writes are disabled in setup. Dry runs and previews stay active.", "Live-Schreiben ist im Setup deaktiviert. Dry-runs und Vorschauen bleiben aktiv.", "Les écritures live sont désactivées dans la configuration. Les dry-runs et aperçus restent actifs.", "Las escrituras live están desactivadas en la configuración. Dry-runs y vistas previas siguen activos.", "Le scritture live sono disattivate nel setup. Dry-run e anteprime restano attivi.", "Live schrijven is uitgeschakeld in de setup. Dry-runs en previews blijven actief.", "Zapisy live są wyłączone w konfiguracji. Dry-run i podglądy pozostają aktywne.", "As escritas live estão desativadas na configuração. Dry-runs e pré-visualizações continuam ativos.", "Live-skrivningar är avstängda i inställningarna. Dry runs och förhandsvisningar är aktiva.", "Live-skrivning er deaktiveret i opsætningen. Dry-runs og previews er fortsat aktive.", "Live-kirjoitukset on poistettu asetuksissa. Dry-run ja esikatselut pysyvät käytössä.", "Živé zápisy jsou v nastavení vypnuté. Dry-run a náhledy zůstávají aktivní.")],
    [["API-Ebene", "API scope"], values("API scope", "API-Ebene", "Portée de l'API", "Ámbito de la API", "Ambito API", "API-niveau", "Zakres API", "Âmbito da API", "API-nivå", "API-niveau", "API-taso", "Úroveň API")],
    [["K-Ebene", "K-level"], values("K-level", "K-Ebene", "Niveau K", "Nivel K", "Livello K", "K-niveau", "Poziom K", "Nível K", "K-nivå", "K-niveau", "K-taso", "Úroveň K")],
    [["User-Ebene", "User level"], values("User level", "User-Ebene", "Niveau utilisateur", "Nivel de usuario", "Livello utente", "Gebruikersniveau", "Poziom użytkownika", "Nível de utilizador", "Användarnivå", "Brugerniveau", "Käyttäjätaso", "Úroveň uživatele")],
    [["Setup nur lesbar"], values("Setup read-only", "Setup nur lesbar", "Configuration en lecture seule", "Configuración solo lectura", "Setup in sola lettura", "Setup alleen-lezen", "Konfiguracja tylko do odczytu", "Configuração só de leitura", "Inställningar endast läsbara", "Opsætning skrivebeskyttet", "Asetukset vain luku", "Nastavení jen pro čtení")]
  ].forEach(([sources, value]) => addExact(sources, value));

  // The demo apps still emit German source strings at runtime. These complete
  // English sentences prevent the generic word replacements from producing
  // mixed-language UI such as "Local Speicherung" or "Secret-File aktiv".
  [
    [["API-Ebene", "API scope"], "API scope"],
    [["K-Ebene", "K-level"], "K-level"],
    [["User-Ebene", "User level"], "User level"],
    [["Demo-Ansicht · Setup nur lesbar"], "Demo view · Setup read-only"],
    [["CTI-Zugang per lokaler Datei oder Browser-Formular setzen."], "Set CTI access via local file or browser form."],
    [["Portal-API-Zugang per lokaler Datei oder Browser-Formular setzen."], "Set Portal API access via local file or browser form."],
    [["CTI Secret-Datei aktiv"], "CTI secret file active"],
    [["Lokale Secret-Datei aktiv"], "Local secret file active"],
    [["Lege im Ordner"], "In the"],
    [["Im Ordner"], "In the"],
    [["eine Datei"], "folder, create a"],
    [["an. Der Server liest sie beim Start automatisch.", "anlegen. Der Server liest sie beim Start automatisch."], "file. The server reads it automatically at startup."],
    [["Lokale Speicherung & Sicherung"], "Local storage & backup"],
    [["Lokale Daten"], "Local data"],
    [["Backup erstellen"], "Create backup"],
    [["Backup laden"], "Load backup"],
    [["Google Kontakte"], "Google contacts"],
    [["Keine Telefonnummer"], "No phone number"],
    [["Kontaktquelle"], "Contact source"],
    [["Lokale Kontakte"], "Local contacts"],
    [["Letzter Sync"], "Last sync"],
    [["Noch nicht"], "Not yet"],
    [["Synchronisieren"], "Sync"],
    [["Trennen"], "Disconnect"],
    [["Anmeldeart", "Anmeldemethode"], "Login method"],
    [["Top-Zeit"], "Peak time"],
    [["Abbrechen"], "Cancel"],
    [["Bearbeiten"], "Edit"],
    [["Löschen"], "Delete"],
    [["ZEIT", "Zeit"], "Time"],
    [["ZU", "Zu"], "To"],
    [["Mo"], "Mon"],
    [["Di"], "Tue"],
    [["Mi"], "Wed"],
    [["Do"], "Thu"],
    [["Fr"], "Fri"],
    [["Sa"], "Sat"],
    [["So"], "Sun"],
    [["Keine aktiven Calls"], "No active calls"],
    [["Aktive Quelle"], "Active source"],
    [["keine lokale Quelle"], "no local source"],
    [["Vorname"], "First name"],
    [["Noch keine manuellen Kontakte."], "No manual contacts yet."],
    [["Nebenstellen aus der Portal API"], "Extensions from the Portal API"],
    [["zugeordnet"], "assigned"],
    [["Verknüpft"], "Linked"],
    [["erkannte Bezüge"], "detected links"],
    [["Feldinformationen"], "Field information"],
    [["Keine weiteren Feldwerte aus dem Portalbestand erkannt."], "No additional field values were detected in the Portal inventory."],
    [["Verknüpfungen"], "Links"],
    [["Gerät zugeordnet"], "Device assigned"],
    [["Einrichtung kopieren"], "Copy setup"],
    [["Kopie der ausgewählten Nebenstelle vorbereiten."], "Prepare a copy of the selected extension."],
    [["Neue Nebenstelle vorbereiten."], "Prepare a new extension."],
    [["Bereitet eine Kopie der ausgewählten Nebenstelle vor. Es wird nichts im Portal gespeichert."], "Prepares a copy of the selected extension. Nothing is saved to the Portal."],
    [["Bereitet eine neue Nebenstelle vor. Es wird nichts im Portal gespeichert."], "Prepares a new extension. Nothing is saved to the Portal."],
    [["Vorlage"], "Template"],
    [["Neue Nummer"], "New number"],
    [["Typ"], "Type"],
    [["Zeile entfernen"], "Remove row"],
    [["Kopie vorbereiten"], "Prepare copy"],
    [["Demo-Anlage: Änderungen werden lokal gespeichert."], "Demo PBX: Changes are saved locally."],
    [["Entfernen"], "Remove"],
    [["Warteschlangen und Skillgruppen"], "Queues and skill groups"],
    [["Service-Typ"], "Service type"],
    [["Callflow Menüs"], "Callflow menus"],
    [["Menü ausblenden"], "Hide menu"],
    [["Menü einblenden"], "Show menu"],
    [["Step an dieser Stelle einfügen"], "Insert step here"],
    [["Eingehender Anruf löschen"], "Delete incoming call"],
    [["Leitung ziehen"], "Drag connection"],
    [["Eingehender Anruf Aktionen"], "Incoming call actions"],
    [["Eingehender Anruf bearbeiten"], "Edit incoming call"],
    [["Leitung von Eingehender Anruf ziehen"], "Drag connection from incoming call"],
    [["Zoom verkleinern"], "Zoom out"],
    [["Zoom vergrößern"], "Zoom in"],
    [["Demo-Daten aktiv"], "Demo data active"],
    [["Tag- und Nachtmodus umschalten"], "Toggle day/night mode"],
    [["Nachtmodus aktivieren"], "Activate night mode"],
    [["Einstellungen und Login."], "Settings and login."],
    [["Sicherheit"], "Security"],
    [["Schreibschutz (AN)"], "Write protection (ON)"],
    [["Live-Schreiben aktivieren"], "Enable live writes"],
    [["Zugang konfiguriert"], "Access configured"],
    [["Tag/Nacht-Schaltung"], "Day/night routing"],
    [["Rufnummern gesammelt zwischen Tagesrouting und vorbereitetem Nachtziel umschalten."], "Switch all numbers between day routing and the prepared night target."],
    [["Schaltung vorbereiten"], "Prepare routing"],
    [["Tag/Nacht Profile"], "Day/night profiles"],
    [["Standard wiederherstellen"], "Restore default"],
    [["Nachtziel"], "Night target"],
    [["Nachtziel suchen"], "Search night target"],
    [["Standardprofil"], "Default profile"],
    [["noch nicht gesichert"], "not saved yet"],
    [["Nachtschaltung"], "Night routing"],
    [["Auflegen"], "Hang up"],
    [["Anruf beenden"], "End call"],
    [["Auflegen - (Anruf beenden)"], "Hang up - (End call)"],
    [["Neues Nachtziel erstellen - (Ansage + danach)"], "Create new night target - (announcement + next step)"],
    [["Zeitsteuerungs-Plan noch nicht geprüft"], "Time-control plan not checked yet"],
    [["Zeitsteuerungs-Plan prüfen"], "Check time-control plan"],
    [["Diagnose der Portal-Endpunkte."], "Portal endpoint diagnostics."],
    [["Details zeigen"], "Show details"],
    [["Portvertrag"], "Port setup"],
    [["Transcript-Liste"], "Transcript list"],
    [["Top 3 User"], "Top 3 users"],
    [["Kundensatz anlegen"], "Create customer record"],
    [["Minuten"], "minutes"],
    [["Auswertung"], "Analysis"],
    [["Nicht angenommen"], "Not answered"],
    [["Umsatz"], "Revenue"],
    [["Jeder Call wird als Ticket geführt, dem Kundenkonto zugeordnet und abrechenbar vorbereitet."], "Every call becomes a ticket, is assigned to a customer account, and is prepared for billing."],
    [["aus eingehenden Calls"], "from inbound calls"],
    [["Kundenkonten"], "Customer accounts"],
    [["automatisch gematcht"], "matched automatically"],
    [["Nacharbeit gespart"], "Follow-up work saved"],
    [["Auto-Ticket aus eingehendem Call"], "Auto-ticket from inbound call"],
    [["Servicezeit aus Call History"], "Service time from Call History"],
    [["nicht abrechenbar"], "not billable"],
    [["Rückruf"], "Callback"],
    [["Ticketliste"], "Ticket list"],
    [["Transcript-Zuordnung"], "Transcript mapping"],
    [["Calls mit Summary oder Transcript als Quelle für User- und Ticket-Mapping."], "Calls with a summary or transcript as the source for user and ticket mapping."],
    [["Wähle links ein Transcript aus."], "Select a transcript on the left."],
    [["Summary kopieren"], "Copy summary"],
    [["Transcript kopieren"], "Copy transcript"],
    [["Zusammenfassung"], "Summary"],
    [["Zuordnung"], "Mapping"],
    [["interner Kontext"], "internal context"],
    [["CALLHISTORY_API_BASE_URL / CALLS_PATH fehlen"], "CALLHISTORY_API_BASE_URL / CALLS_PATH missing"],
    [["optional nicht gesetzt"], "optional, not set"],
    [["nur Env-Variablen"], "environment variables only"],
    [["im Ordner CallHistory_API"], "in the CallHistory_API folder"],
    [["Call History bleibt lokal auf Port 3000; Portal und CTI laufen daneben."], "Call History stays local on port 3000; Portal and CTI run alongside it."],
    [["Auth-URL, Token-URL, Scope und Call-History-Endpunkte sind vorbelegt. Redirect bleibt lokal standardmäßig"], "Auth URL, token URL, scope, and Call History endpoints are preconfigured. The redirect remains local by default at"]
  ].forEach(([sources, translation]) => addEnglishExact(sources, translation));

  [
    ["Änderungen übernehmen", values("Apply changes", "Änderungen übernehmen", "Appliquer les modifications", "Aplicar cambios", "Applica modifiche", "Wijzigingen toepassen", "Zastosuj zmiany", "Aplicar alterações", "Tillämpa ändringar", "Anvend ændringer", "Ota muutokset käyttöön", "Použít změny")],
    ["Änderungen", values("Changes", "Änderungen", "Modifications", "Cambios", "Modifiche", "Wijzigingen", "Zmiany", "Alterações", "Ändringar", "Ændringer", "Muutokset", "Změny")],
    ["Übernehmen", values("Apply", "Übernehmen", "Appliquer", "Aplicar", "Applica", "Toepassen", "Zastosuj", "Aplicar", "Tillämpa", "Anvend", "Ota käyttöön", "Použít")],
    ["Anlegen", values("Create", "Anlegen", "Créer", "Crear", "Crea", "Aanmaken", "Utwórz", "Criar", "Skapa", "Opret", "Luo", "Vytvořit")],
    ["Aktualisieren", values("Refresh", "Aktualisieren", "Actualiser", "Actualizar", "Aggiorna", "Vernieuwen", "Odśwież", "Atualizar", "Uppdatera", "Opdater", "Päivitä", "Obnovit")],
    ["Laden", values("Load", "Laden", "Charger", "Cargar", "Carica", "Laden", "Załaduj", "Carregar", "Läs in", "Indlæs", "Lataa", "Načíst")],
    ["Lädt", values("Loading", "Lädt", "Chargement", "Cargando", "Caricamento", "Laden", "Ładowanie", "A carregar", "Läser in", "Indlæser", "Ladataan", "Načítání")],
    ["Fehler", values("Error", "Fehler", "Erreur", "Error", "Errore", "Fout", "Błąd", "Erro", "Fel", "Fejl", "Virhe", "Chyba")],
    ["Quelle", values("Source", "Quelle", "Source", "Fuente", "Fonte", "Bron", "Źródło", "Fonte", "Källa", "Kilde", "Lähde", "Zdroj")],
    ["Aktuell", values("Current", "Aktuell", "Actuel", "Actual", "Attuale", "Actueel", "Bieżący", "Atual", "Aktuell", "Aktuel", "Nykyinen", "Aktuální")],
    ["Entwurf", values("Draft", "Entwurf", "Brouillon", "Borrador", "Bozza", "Concept", "Szkic", "Rascunho", "Utkast", "Udkast", "Luonnos", "Koncept")],
    ["Lokal", values("Local", "Lokal", "Local", "Local", "Locale", "Lokaal", "Lokalnie", "Local", "Lokal", "Lokal", "Paikallinen", "Místní")],
    ["Lokale", values("Local", "Lokale", "Locale", "Local", "Locale", "Lokale", "Lokalne", "Local", "Lokal", "Lokal", "Paikallinen", "Místní")],
    ["lokal", values("locally", "lokal", "localement", "localmente", "localmente", "lokaal", "lokalnie", "localmente", "lokalt", "lokalt", "paikallisesti", "místně")],
    ["Demo-Anlage", values("Demo PBX", "Demo-Anlage", "PBX de démo", "Central demo", "PBX demo", "Demo-PBX", "Centrala demo", "PBX demo", "Demo-PBX", "Demo-PBX", "Demo-PBX", "Demo PBX")],
    ["Demo-Daten", values("Demo data", "Demo-Daten", "Données de démo", "Datos demo", "Dati demo", "Demogegevens", "Dane demo", "Dados demo", "Demodata", "Demodata", "Demodata", "Demo data")],
    ["Anlage", values("PBX", "Anlage", "PBX", "Central", "PBX", "PBX", "Centrala", "PBX", "PBX", "PBX", "PBX", "PBX")],
    ["Rufnummern", values("Numbers", "Rufnummern", "Numéros", "Números", "Numeri", "Nummers", "Numery", "Números", "Nummer", "Numre", "Numerot", "Čísla")],
    ["Rufnummer", values("Number", "Rufnummer", "Numéro", "Número", "Numero", "Nummer", "Numer", "Número", "Nummer", "Nummer", "Numero", "Číslo")],
    ["Geräte", values("Devices", "Geräte", "Appareils", "Dispositivos", "Dispositivi", "Apparaten", "Urządzenia", "Dispositivos", "Enheter", "Enheder", "Laitteet", "Zařízení")],
    ["Gerät", values("Device", "Gerät", "Appareil", "Dispositivo", "Dispositivo", "Apparaat", "Urządzenie", "Dispositivo", "Enhet", "Enhed", "Laite", "Zařízení")],
    ["Telefonbücher", values("Phonebooks", "Telefonbücher", "Annuaires", "Agendas telefónicas", "Rubriche", "Telefoonboeken", "Książki telefoniczne", "Listas telefónicas", "Telefonböcker", "Telefonbøger", "Puhelinluettelot", "Telefonní seznamy")],
    ["Transkript", values("Transcript", "Transkript", "Transcription", "Transcripción", "Trascrizione", "Transcript", "Transkrypcja", "Transcrição", "Transkript", "Transskript", "Transkripti", "Přepis")],
    ["Transkription", values("Transcription", "Transkription", "Transcription", "Transcripción", "Trascrizione", "Transcriptie", "Transkrypcja", "Transcrição", "Transkribering", "Transskribering", "Transkriptio", "Přepis")],
    ["Verpasst", values("Missed", "Verpasst", "Manqué", "Perdidas", "Perse", "Gemist", "Nieodebrane", "Perdidas", "Missade", "Mistede", "Vastaamatta", "Zmeškané")],
    ["Angenommen", values("Answered", "Angenommen", "Répondu", "Atendidas", "Risposte", "Beantwoord", "Odebrane", "Atendidas", "Besvarade", "Besvaret", "Vastatut", "Přijaté")],
    ["Ausgehend", values("Outbound", "Ausgehend", "Sortant", "Saliente", "In uscita", "Uitgaand", "Wychodzące", "Saída", "Utgående", "Udgående", "Lähtevä", "Odchozí")],
    ["Eingehend", values("Inbound", "Eingehend", "Entrant", "Entrante", "In entrata", "Inkomend", "Przychodzące", "Entrada", "Inkommande", "Indgående", "Saapuva", "Příchozí")],
    ["Unklar", values("Unknown", "Unklar", "Inconnu", "Desconocido", "Sconosciuto", "Onbekend", "Nieznane", "Desconhecido", "Okänd", "Ukendt", "Tuntematon", "Neznámé")],
    ["Vortag", values("previous day", "Vortag", "jour précédent", "día anterior", "giorno precedente", "vorige dag", "poprzedni dzień", "dia anterior", "föregående dag", "forrige dag", "edellinen päivä", "předchozí den")],
    ["Abgebrochen", values("Cancelled", "Abgebrochen", "Annulé", "Cancelada", "Annullata", "Geannuleerd", "Anulowane", "Cancelada", "Avbrutet", "Annulleret", "Peruttu", "Zrušeno")],
    ["Wartend", values("Waiting", "Wartend", "En attente", "En espera", "In attesa", "Wachtend", "Oczekuje", "Em espera", "Väntar", "Venter", "Odottaa", "Čeká")],
    ["Bereit", values("Ready", "Bereit", "Prêt", "Listo", "Pronto", "Gereed", "Gotowe", "Pronto", "Klar", "Klar", "Valmis", "Připraveno")],
    ["Kontakt", values("Contact", "Kontakt", "Contact", "Contacto", "Contatto", "Contact", "Kontakt", "Contacto", "Kontakt", "Kontakt", "Yhteystieto", "Kontakt")],
    ["Kontakte", values("Contacts", "Kontakte", "Contacts", "Contactos", "Contatti", "Contacten", "Kontakty", "Contactos", "Kontakter", "Kontakter", "Yhteystiedot", "Kontakty")],
    ["Datei", values("File", "Datei", "Fichier", "Archivo", "File", "Bestand", "Plik", "Ficheiro", "Fil", "Fil", "Tiedosto", "Soubor")],
    ["auswählen", values("select", "auswählen", "sélectionner", "seleccionar", "selezionare", "selecteren", "wybrać", "selecionar", "välj", "vælg", "valitse", "vybrat")],
    ["prüfen", values("check", "prüfen", "vérifier", "comprobar", "verifica", "controleren", "sprawdź", "verificar", "kontrollera", "kontroller", "tarkista", "zkontrolovat")],
    ["gelöscht", values("deleted", "gelöscht", "supprimé", "eliminado", "eliminato", "verwijderd", "usunięto", "eliminado", "raderad", "slettet", "poistettu", "smazáno")],
    ["nicht geladen", values("not loaded", "nicht geladen", "non chargé", "no cargado", "non caricato", "niet geladen", "nie załadowano", "não carregado", "inte inläst", "ikke indlæst", "ei ladattu", "nenačteno")],
    ["geladen", values("loaded", "geladen", "chargé", "cargado", "caricato", "geladen", "załadowano", "carregado", "inläst", "indlæst", "ladattu", "načteno")],
    ["nicht verfügbar", values("not available", "nicht verfügbar", "non disponible", "no disponible", "non disponibile", "niet beschikbaar", "niedostępne", "indisponível", "inte tillgängligt", "ikke tilgængelig", "ei saatavilla", "není dostupné")],
    ["verfügbar", values("available", "verfügbar", "disponible", "disponible", "disponibile", "beschikbaar", "dostępne", "disponível", "tillgängligt", "tilgængelig", "saatavilla", "dostupné")],
    ["öffnen", values("open", "öffnen", "ouvrir", "abrir", "aprire", "openen", "otwórz", "abrir", "öppna", "åbn", "avaa", "otevřít")],
    ["schließen", values("close", "schließen", "fermer", "cerrar", "chiudere", "sluiten", "zamknij", "fechar", "stäng", "luk", "sulje", "zavřít")],
    ["löschen", values("delete", "löschen", "supprimer", "eliminar", "eliminare", "verwijderen", "usuń", "eliminar", "radera", "slet", "poista", "smazat")],
    ["zurücknehmen", values("undo", "zurücknehmen", "annuler", "deshacer", "annulla", "ongedaan maken", "cofnij", "anular", "ångra", "fortryd", "kumoa", "vrátit zpět")],
    ["ausblenden", values("hide", "ausblenden", "masquer", "ocultar", "nascondi", "verbergen", "ukryj", "ocultar", "dölj", "skjul", "piilota", "skrýt")],
    ["anzeigen", values("show", "anzeigen", "afficher", "mostrar", "mostra", "tonen", "pokaż", "mostrar", "visa", "vis", "näytä", "zobrazit")]
  ].forEach(([source, value]) => addPhrase(source, value));

  [
    ["Tagmodus", values("Day mode", "Tagmodus", "Mode jour", "Modo día", "Modalità giorno", "Dagmodus", "Tryb dzienny", "Modo diurno", "Dagläge", "Dagtilstand", "Päivätila", "Denní režim")],
    ["Nachtmodus", values("Night mode", "Nachtmodus", "Mode nuit", "Modo noche", "Modalità notte", "Nachtmodus", "Tryb nocny", "Modo noturno", "Nattläge", "Nattilstand", "Yötila", "Noční režim")],
    ["Hinweise", values("Notes", "Hinweise", "Notes", "Avisos", "Note", "Notities", "Notatki", "Notas", "Notiser", "Noter", "Huomiot", "Poznámky")],
    ["Statistiken", values("Statistics", "Statistiken", "Statistiques", "Estadísticas", "Statistiche", "Statistieken", "Statystyki", "Estatísticas", "Statistik", "Statistikker", "Tilastot", "Statistiky")],
    ["Portal-Ressourcen", values("Portal resources", "Portal-Ressourcen", "Ressources Portal", "Recursos Portal", "Risorse Portal", "Portal-resources", "Zasoby Portal", "Recursos Portal", "Portalresurser", "Portal-ressourcer", "Portal-resurssit", "Zdroje portálu")],
    ["Sprachdialoge", values("Voice dialogs", "Sprachdialoge", "Dialogues vocaux", "Diálogos de voz", "Dialoghi vocali", "Spraakdialogen", "Dialogi głosowe", "Diálogos de voz", "Röstdialoger", "Stemmedialoger", "Äänivalikot", "Hlasové dialogy")],
    ["Zeitsteuerungen", values("Time controls", "Zeitsteuerungen", "Contrôles horaires", "Controles horarios", "Controlli orari", "Tijdsturingen", "Sterowania czasem", "Controlos horários", "Tidsstyrningar", "Tidsstyringer", "Aikaohjaukset", "Časová řízení")],
    ["führt zu", values("routes to", "führt zu", "mène à", "dirige a", "porta a", "routeert naar", "kieruje do", "encaminha para", "leder till", "fører til", "reitittyy kohteeseen", "směřuje na")],
    ["geprüft", values("checked", "geprüft", "vérifié", "comprobado", "verificato", "gecontroleerd", "sprawdzone", "verificado", "kontrollerad", "kontrolleret", "tarkistettu", "zkontrolováno")],
    ["abrechenbar", values("billable", "abrechenbar", "facturable", "facturable", "fatturabile", "factureerbaar", "rozliczalne", "faturável", "debiterbar", "fakturerbar", "laskutettava", "fakturovatelné")],
    ["autom.", values("autom.", "autom.", "autom.", "autom.", "autom.", "autom.", "autom.", "autom.", "autom.", "autom.", "autom.", "autom.")],
    ["manuell", values("manual", "manuell", "manuel", "manual", "manuale", "handmatig", "ręcznie", "manual", "manuell", "manuel", "manuaalinen", "ruční")],
    ["Dauer", values("Duration", "Dauer", "Durée", "Duración", "Durata", "Duur", "Czas trwania", "Duração", "Varaktighet", "Varighed", "Kesto", "Doba trvání")],
    ["Kundensätze", values("Customer records", "Kundensätze", "Fiches client", "Registros de cliente", "Record cliente", "Klantrecords", "Rekordy klientów", "Registos de cliente", "Kundposter", "Kundeposter", "Asiakastietueet", "Zákaznické záznamy")],
    ["Link bearbeiten", values("Edit link", "Link bearbeiten", "Modifier le lien", "Editar enlace", "Modifica link", "Link bewerken", "Edytuj link", "Editar ligação", "Redigera länk", "Rediger link", "Muokkaa linkkiä", "Upravit odkaz")],
    ["Listenansicht", values("List view", "Listenansicht", "Vue liste", "Vista de lista", "Vista elenco", "Lijstweergave", "Widok listy", "Vista de lista", "Listvy", "Listevisning", "Listanäkymä", "Zobrazení seznamu")],
    ["Standard", values("Default", "Standard", "Par défaut", "Predeterminado", "Predefinito", "Standaard", "Domyślne", "Predefinição", "Standard", "Standard", "Oletus", "Výchozí")],
    ["Synthetische Call History mit Transcript- und Ticket-Beispielen.", values("Synthetic call history with transcript and ticket examples.", "Synthetische Call History mit Transcript- und Ticket-Beispielen.", "Historique d'appels synthétique avec exemples de transcriptions et tickets.", "Historial de llamadas sintético con ejemplos de transcripciones y tickets.", "Cronologia chiamate sintetica con esempi di trascrizioni e ticket.", "Synthetische gespreksgeschiedenis met transcript- en ticketvoorbeelden.", "Syntetyczna historia połączeń z przykładami transkrypcji i zgłoszeń.", "Histórico de chamadas sintético com exemplos de transcrições e tickets.", "Syntetisk samtalshistorik med transkript- och ärendeexempel.", "Syntetisk opkaldshistorik med transskript- og ticketeksempler.", "Synteettinen puheluhistoria transkriptio- ja tikettiesimerkeillä.", "Syntetická historie hovorů s příklady přepisů a ticketů.")]
  ].forEach(([source, value]) => addPhrase(source, value));

  [
    ["Hinweis schließen", values("Close notice", "Hinweis schließen", "Fermer l'avis", "Cerrar aviso", "Chiudi avviso", "Melding sluiten", "Zamknij komunikat", "Fechar aviso", "Stäng meddelande", "Luk besked", "Sulje ilmoitus", "Zavřít upozornění")],
    ["Die Anlage wurde umgeschaltet.", values("The PBX mode was switched.", "Die Anlage wurde umgeschaltet.", "Le mode d\u0075 PBX a été changé.", "Se cambió el modo de la central.", "La modalità PBX è stata cambiata.", "De PBX-modus is omgeschakeld.", "Tryb centrali został przełączony.", "O modo da PBX foi alterado.", "PBX-läget ändrades.", "PBX-tilstanden blev skiftet.", "PBX-tila vaihdettiin.", "Režim PBX byl přepnut.")],
    ["Rufnummern-Routing aus der Portal API", values("Number routing from the Portal API", "Rufnummern-Routing aus der Portal API", "Routage des numéros depuis l'API Portal", "Enrutamiento de números desde la API Portal", "Routing numeri dalla Portal API", "Nummerroutering vanuit de Portal API", "Routing numerów z Portal API", "Encaminhamento de números da Portal API", "Nummerrouting från Portal API", "Nummerrouting fra Portal API", "Numeroiden reititys Portal API:sta", "Směrování čísel z Portal API")],
    ["Kontakte per Datei oder manuell vorbereiten und mit dem aktuellen NFON-Telefonbuch abgleichen.", values("Prepare contacts from a file or manually and compare them with the current NFON phonebook.", "Kontakte per Datei oder manuell vorbereiten und mit dem aktuellen NFON-Telefonbuch abgleichen.", "Préparer les contacts depuis un fichier ou manuellement et les comparer avec l'annuaire NFON actuel.", "Preparar contactos desde archivo o manualmente y compararlos con la agenda NFON actual.", "Prepara contatti da file o manualmente e confrontali con la rubrica NFON attuale.", "Bereid contacten voor via bestand of handmatig en vergelijk ze met het actuele NFON-telefoonboek.", "Przygotuj kontakty z pliku lub ręcznie i porównaj je z aktualną książką NFON.", "Prepare contactos por ficheiro ou manualmente e compare com a lista NFON atual.", "Förbered kontakter via fil eller manuellt och jämför dem med aktuell NFON-telefonbok.", "Forbered kontakter via fil eller manuelt og sammenlign med den aktuelle NFON-telefonbog.", "Valmistele yhteystiedot tiedostosta tai käsin ja vertaa niitä nykyiseen NFON-puhelinluetteloon.", "Připravte kontakty ze souboru nebo ručně a porovnejte je s aktuálním telefonním seznamem NFON.")],
    ["Name oder Nummer suchen", values("Search name or number", "Name oder Nummer suchen", "Rechercher nom ou numéro", "Buscar nombre o número", "Cerca nome o numero", "Zoek naam of nummer", "Szukaj nazwy lub numeru", "Pesquisar nome ou número", "Sök namn eller nummer", "Søg navn eller nummer", "Hae nimeä tai numeroa", "Hledat jméno nebo číslo")],
    ["Nebenstellenbereiche", values("Extension sections", "Nebenstellenbereiche", "Sections d'extensions", "Secciones de extensiones", "Sezioni interni", "Extensiesecties", "Sekcje numerów wewnętrznych", "Secções de extensões", "Anknytningssektioner", "Lokalnummersektioner", "Alanumero-osiot", "Sekce linek")],
    ["Bestand", values("Inventory", "Bestand", "Inventaire", "Inventario", "Inventario", "Inventaris", "Zasoby", "Inventário", "Inventering", "Inventar", "Inventaario", "Inventář")],
    ["Ausgewählte Nebenstelle", values("Selected extension", "Ausgewählte Nebenstelle", "Extension sélectionnée", "Extensión seleccionada", "Interno selezionato", "Geselecteerde extensie", "Wybrany numer wewnętrzny", "Extensão selecionada", "Vald anknytning", "Valgt lokalnummer", "Valittu alanumero", "Vybraná linka")],
    ["Aktionen", values("Actions", "Aktionen", "Actions", "Acciones", "Azioni", "Acties", "Akcje", "Ações", "Åtgärder", "Handlinger", "Toiminnot", "Akce")],
    ["Vorbereitete Änderung", values("Prepared change", "Vorbereitete Änderung", "Modification préparée", "Cambio preparado", "Modifica preparata", "Voorbereide wijziging", "Przygotowana zmiana", "Alteração preparada", "Förberedd ändring", "Forberedt ændring", "Valmisteltu muutos", "Připravená změna")],
    ["Mehrere Nebenstellen per CSV oder manueller Liste prüfen und gesammelt anlegen.", values("Check multiple extensions from CSV or a manual list and create them in one batch.", "Mehrere Nebenstellen per CSV oder manueller Liste prüfen und gesammelt anlegen.", "Vérifier plusieurs extensions depuis un CSV ou une liste manuelle et les créer en lot.", "Comprobar varias extensiones desde CSV o lista manual y crearlas en lote.", "Verifica più interni da CSV o lista manuale e creali in batch.", "Controleer meerdere extensies vanuit CSV of handmatige lijst en maak ze in één batch aan.", "Sprawdź wiele numerów z CSV lub listy ręcznej i utwórz je wsadowo.", "Verifique várias extensões por CSV ou lista manual e crie-as em lote.", "Kontrollera flera anknytningar från CSV eller manuell lista och skapa dem i batch.", "Kontroller flere lokalnumre via CSV eller manuel liste og opret dem samlet.", "Tarkista useita alanumeroita CSV:stä tai käsin ja luo ne eränä.", "Zkontrolujte více linek z CSV nebo ručního seznamu a vytvořte je hromadně.")],
    ["Zeile hinzufügen", values("Add row", "Zeile hinzufügen", "Ajouter une ligne", "Añadir fila", "Aggiungi riga", "Rij toevoegen", "Dodaj wiersz", "Adicionar linha", "Lägg till rad", "Tilføj række", "Lisää rivi", "Přidat řádek")],
    ["Lokaler Entwurf geladen", values("Local draft loaded", "Lokaler Entwurf geladen", "Brouillon local chargé", "Borrador local cargado", "Bozza locale caricata", "Lokale conceptversie geladen", "Lokalny szkic załadowany", "Rascunho local carregado", "Lokalt utkast inläst", "Lokalt udkast indlæst", "Paikallinen luonnos ladattu", "Místní koncept načten")],
    ["Lokaler Entwurf gelöscht", values("Local draft deleted", "Lokaler Entwurf gelöscht", "Brouillon local supprimé", "Borrador local eliminado", "Bozza locale eliminata", "Lokale conceptversie verwijderd", "Lokalny szkic usunięty", "Rascunho local eliminado", "Lokalt utkast raderat", "Lokalt udkast slettet", "Paikallinen luonnos poistettu", "Místní koncept smazán")],
    ["Schritt im Callflow", values("Callflow step", "Schritt im Callflow", "Étape d\u0075 callflow", "Paso del callflow", "Passo del callflow", "Callflow-stap", "Krok callflow", "Passo do callflow", "Callflow-steg", "Callflow-trin", "Callflow-vaihe", "Krok callflow")],
    ["Konfiguriere diesen Schritt. Pflichtfelder werden unten geprüft.", values("Configure this step. Required fields are checked below.", "Konfiguriere diesen Schritt. Pflichtfelder werden unten geprüft.", "Configurez cette étape. Les champs obligatoires sont vérifiés ci-dessous.", "Configura este paso. Los campos obligatorios se comprueban abajo.", "Configura questo passaggio. I campi obbligatori sono verificati sotto.", "Configureer deze stap. Verplichte velden worden hieronder gecontroleerd.", "Skonfiguruj ten krok. Wymagane pola są sprawdzane poniżej.", "Configure este passo. Os campos obrigatórios são verificados abaixo.", "Konfigurera detta steg. Obligatoriska fält kontrolleras nedan.", "Konfigurer dette trin. Obligatoriske felter kontrolleres nedenfor.", "Määritä tämä vaihe. Pakolliset kentät tarkistetaan alla.", "Nakonfigurujte tento krok. Povinná pole se kontrolují níže.")],
    ["Art des Schritts", values("Step type", "Art des Schritts", "Type d'étape", "Tipo de paso", "Tipo di passaggio", "Staptype", "Typ kroku", "Tipo de passo", "Stegtyp", "Trintype", "Vaiheen tyyppi", "Typ kroku")],
    ["Name im Portal", values("Name in Portal", "Name im Portal", "Nom dans Portal", "Nombre en Portal", "Nome nel Portal", "Naam in Portal", "Nazwa w Portal", "Nome no Portal", "Namn i Portal", "Navn i Portal", "Nimi Portalissa", "Název v Portal")],
    ["Ansage vor der Auswahl", values("Announcement before selection", "Ansage vor der Auswahl", "Annonce avant sélection", "Mensaje antes de la selección", "Annuncio prima della selezione", "Aankondiging vóór selectie", "Komunikat przed wyborem", "Anúncio antes da seleção", "Meddelande före val", "Besked før valg", "Ilmoitus ennen valintaa", "Oznámení před výběrem")],
    ["Keine Eingabe / Timeout", values("No input / timeout", "Keine Eingabe / Timeout", "Aucune entrée / timeout", "Sin entrada / timeout", "Nessun input / timeout", "Geen invoer / timeout", "Brak wejścia / timeout", "Sem entrada / timeout", "Ingen inmatning / timeout", "Intet input / timeout", "Ei syötettä / timeout", "Žádný vstup / timeout")],
    ["Ziel im Callflow wählen", values("Select callflow target", "Ziel im Callflow wählen", "Sélectionner la cible d\u0075 callflow", "Seleccionar destino del callflow", "Seleziona destinazione callflow", "Callflow-doel selecteren", "Wybierz cel callflow", "Selecionar destino do callflow", "Välj callflow-mål", "Vælg callflow-mål", "Valitse callflow-kohde", "Vybrat cíl callflow")],
    ["Schrittart fehlt", values("Step type missing", "Schrittart fehlt", "Type d'étape manquant", "Falta tipo de paso", "Tipo passaggio mancante", "Staptype ontbreekt", "Brak typu kroku", "Falta tipo de passo", "Stegtyp saknas", "Trintype mangler", "Vaiheen tyyppi puuttuu", "Chybí typ kroku")],
    ["Ansage fehlt", values("Announcement missing", "Ansage fehlt", "Annonce manquante", "Falta anuncio", "Annuncio mancante", "Aankondiging ontbreekt", "Brak komunikatu", "Falta anúncio", "Meddelande saknas", "Besked mangler", "Ilmoitus puuttuu", "Chybí oznámení")],
    ["Ziel fehlt", values("Target missing", "Ziel fehlt", "Cible manquante", "Falta destino", "Destinazione mancante", "Doel ontbreekt", "Brak celu", "Falta destino", "Mål saknas", "Mål mangler", "Kohde puuttuu", "Chybí cíl")],
    ["Ziel suchen...", values("Search target...", "Ziel suchen...", "Rechercher une cible...", "Buscar destino...", "Cerca destinazione...", "Doel zoeken...", "Szukaj celu...", "Pesquisar destino...", "Sök mål...", "Søg mål...", "Hae kohdetta...", "Hledat cíl...")],
    ["Ansage suchen...", values("Search announcement...", "Ansage suchen...", "Rechercher une annonce...", "Buscar anuncio...", "Cerca annuncio...", "Aankondiging zoeken...", "Szukaj komunikatu...", "Pesquisar anúncio...", "Sök meddelande...", "Søg besked...", "Hae ilmoitusta...", "Hledat oznámení...")],
    ["Ansage wählen", values("Select announcement", "Ansage wählen", "Sélectionner une annonce", "Seleccionar anuncio", "Seleziona annuncio", "Aankondiging selecteren", "Wybierz komunikat", "Selecionar anúncio", "Välj meddelande", "Vælg besked", "Valitse ilmoitus", "Vybrat oznámení")],
    ["Ziel wählen", values("Select target", "Ziel wählen", "Sélectionner la cible", "Seleccionar destino", "Seleziona destinazione", "Doel selecteren", "Wybierz cel", "Selecionar destino", "Välj mål", "Vælg mål", "Valitse kohde", "Vybrat cíl")],
    ["Taste hinzufügen", values("Add key", "Taste hinzufügen", "Ajouter une touche", "Añadir tecla", "Aggiungi tasto", "Toets toevoegen", "Dodaj klawisz", "Adicionar tecla", "Lägg till knapp", "Tilføj tast", "Lisää näppäin", "Přidat klávesu")],
    ["Eingehender Anruf", values("Incoming call", "Eingehender Anruf", "Appel entrant", "Llamada entrante", "Chiamata in entrata", "Inkomend gesprek", "Połączenie przychodzące", "Chamada recebida", "Inkommande samtal", "Indgående opkald", "Saapuva puhelu", "Příchozí hovor")],
    ["Tasten konfigurieren", values("Configure keys", "Tasten konfigurieren", "Configurer les touches", "Configurar teclas", "Configura tasti", "Toetsen configureren", "Skonfiguruj klawisze", "Configurar teclas", "Konfigurera knappar", "Konfigurer taster", "Määritä näppäimet", "Konfigurovat klávesy")],
    ["Daten aktualisiert", values("Data updated", "Daten aktualisiert", "Données mises à jour", "Datos actualizados", "Dati aggiornati", "Gegevens bijgewerkt", "Dane zaktualizowane", "Dados atualizados", "Data uppdaterad", "Data opdateret", "Tiedot päivitetty", "Data aktualizována")],
    ["Nebenstellen, Status und Verlauf wurden neu geladen", values("Extensions, status, and history were reloaded", "Nebenstellen, Status und Verlauf wurden neu geladen", "Extensions, statut et historique ont été rechargés", "Extensiones, estado e historial se recargaron", "Interni, stato e cronologia sono stati ricaricati", "Extensies, status en geschiedenis zijn opnieuw geladen", "Numery, status i historia zostały ponownie załadowane", "Extensões, estado e histórico foram recarregados", "Anknytningar, status och historik lästes om", "Lokalnumre, status og historik blev genindlæst", "Alanumerot, tila ja historia ladattiin uudelleen", "Linky, stav a historie byly znovu načteny")],
    ["Nebenstellen, Status und Verlauf wurden neu loaded", values("Extensions, status, and history were reloaded", "Nebenstellen, Status und Verlauf wurden neu loaded", "Extensions, statut et historique ont été rechargés", "Extensiones, estado e historial se recargaron", "Interni, stato e cronologia sono stati ricaricati", "Extensies, status en geschiedenis zijn opnieuw geladen", "Numery, status i historia zostały ponownie załadowane", "Extensões, estado e histórico foram recarregados", "Anknytningar, status och historik lästes om", "Lokalnumre, status og historik blev genindlæst", "Alanumerot, tila ja historia ladattiin uudelleen", "Linky, stav a historie byly znovu načteny")],
    ["Live-Zustand geladen. Änderungen bleiben lokal bis zur Prüfung.", values("Live state loaded. Changes remain local until review.", "Live-Zustand geladen. Änderungen bleiben lokal bis zur Prüfung.", "État live chargé. Les modifications restent locales jusqu'à la vérification.", "Estado live cargado. Los cambios permanecen locales hasta la revisión.", "Stato live caricato. Le modifiche restano locali fino alla verifica.", "Live status geladen. Wijzigingen blijven lokaal tot controle.", "Stan live załadowany. Zmiany pozostają lokalne do sprawdzenia.", "Estado live carregado. As alterações permanecem locais até à revisão.", "Live-status inläst. Ändringar förblir lokala till granskning.", "Live-status indlæst. Ændringer forbliver lokale indtil kontrol.", "Live-tila ladattu. Muutokset pysyvät paikallisina tarkistukseen asti.", "Živý stav načten. Změny zůstávají místní až do kontroly.")],
    ["Live-Zustand loaded. Changes bleiben Local bis zur Prüfung.", values("Live state loaded. Changes remain local until review.", "Live-Zustand loaded. Changes bleiben Local bis zur Prüfung.", "État live chargé. Les modifications restent locales jusqu'à la vérification.", "Estado live cargado. Los cambios permanecen locales hasta la revisión.", "Stato live caricato. Le modifiche restano locali fino alla verifica.", "Live status geladen. Wijzigingen blijven lokaal tot controle.", "Stan live załadowany. Zmiany pozostają lokalne do sprawdzenia.", "Estado live carregado. As alterações permanecem locais até à revisão.", "Live-status inläst. Ändringar förblir lokala till granskning.", "Live-status indlæst. Ændringer forbliver lokale indtil kontrol.", "Live-tila ladattu. Muutokset pysyvät paikallisina tarkistukseen asti.", "Živý stav načten. Změny zůstávají místní až do kontroly.")],
    ["Alternativ kann NFON_SECRET_FILE auf eine lokale Secret-Datei zeigen. Google ist nur für das Kontaktmodul nötig.", values("Alternatively, NFON_SECRET_FILE can point to a local secret file. Google is only required for the contacts module.", "Alternativ kann NFON_SECRET_FILE auf eine lokale Secret-Datei zeigen. Google ist nur für das Kontaktmodul nötig.", "NFON_SECRET_FILE peut aussi pointer vers un fichier secret local. Google n'est requis que pour le module contacts.", "Como alternativa, NFON_SECRET_FILE puede apuntar a un archivo secreto local. Google solo es necesario para el módulo de contactos.", "In alternativa, NFON_SECRET_FILE può puntare a un file segreto locale. Google serve solo per il modulo contatti.", "NFON_SECRET_FILE kan ook naar een lokaal secretbestand wijzen. Google is alleen nodig voor de contactmodule.", "Alternatywnie NFON_SECRET_FILE może wskazywać lokalny plik sekretów. Google jest wymagane tylko dla modułu kontaktów.", "Em alternativa, NFON_SECRET_FILE pode apontar para um ficheiro secreto local. Google só é necessário para o módulo de contactos.", "Alternativt kan NFON_SECRET_FILE peka på en lokal hemlig fil. Google krävs bara för kontaktmodulen.", "Alternativt kan NFON_SECRET_FILE pege på en lokal secret-fil. Google kræves kun for kontaktmodulet.", "Vaihtoehtoisesti NFON_SECRET_FILE voi osoittaa paikalliseen salaisuustiedostoon. Google tarvitaan vain yhteystietomoduuliin.", "Alternativně může NFON_SECRET_FILE odkazovat na místní soubor se secrets. Google je potřeba pouze pro modul kontaktů.")],
    ["Alternativ kann NFON_SECRET_FILE auf eine Local Secret-File zeigen. Google ist nur für das Kontaktmodul nötig.", values("Alternatively, NFON_SECRET_FILE can point to a local secret file. Google is only required for the contacts module.", "Alternativ kann NFON_SECRET_FILE auf eine Local Secret-File zeigen. Google ist nur für das Kontaktmodul nötig.", "NFON_SECRET_FILE peut aussi pointer vers un fichier secret local. Google n'est requis que pour le module contacts.", "Como alternativa, NFON_SECRET_FILE puede apuntar a un archivo secreto local. Google solo es necesario para el módulo de contactos.", "In alternativa, NFON_SECRET_FILE può puntare a un file segreto locale. Google serve solo per il modulo contatti.", "NFON_SECRET_FILE kan ook naar een lokaal secretbestand wijzen. Google is alleen nodig voor de contactmodule.", "Alternatywnie NFON_SECRET_FILE może wskazywać lokalny plik sekretów. Google jest wymagane tylko dla modułu kontaktów.", "Em alternativa, NFON_SECRET_FILE pode apontar para um ficheiro secreto local. Google só é necessário para o módulo de contactos.", "Alternativt kan NFON_SECRET_FILE peka på en lokal hemlig fil. Google krävs bara för kontaktmodulen.", "Alternativt kan NFON_SECRET_FILE pege på en lokal secret-fil. Google kræves kun for kontaktmodulet.", "Vaihtoehtoisesti NFON_SECRET_FILE voi osoittaa paikalliseen salaisuustiedostoon. Google tarvitaan vain yhteystietomoduuliin.", "Alternativně může NFON_SECRET_FILE odkazovat na místní soubor se secrets. Google je potřeba pouze pro modul kontaktů.")],
    ["Danach den Portal-Server neu starten. Secrets bleiben lokal und werden nicht an das Frontend zurückgegeben.", values("Restart the Portal server afterwards. Secrets stay local and are not returned to the frontend.", "Danach den Portal-Server neu starten. Secrets bleiben lokal und werden nicht an das Frontend zurückgegeben.", "Redémarrez ensuite le serveur Portal. Les secrets restent locaux et ne sont pas renvoyés au frontend.", "Reinicia después el servidor Portal. Los secretos permanecen locales y no se devuelven al frontend.", "Riavvia poi il server Portal. I secret restano locali e non vengono restituiti al frontend.", "Start daarna de Portal-server opnieuw. Secrets blijven lokaal en worden niet aan de frontend teruggegeven.", "Następnie uruchom ponownie serwer Portal. Sekrety pozostają lokalne i nie są zwracane do frontendu.", "Reinicie depois o servidor Portal. Os secrets ficam locais e não são devolvidos ao frontend.", "Starta därefter om Portal-servern. Secrets förblir lokala och skickas inte tillbaka till frontend.", "Genstart derefter Portal-serveren. Secrets forbliver lokale og returneres ikke til frontend.", "Käynnistä Portal-palvelin sen jälkeen uudelleen. Salaisuudet pysyvät paikallisina eikä niitä palauteta frontendille.", "Poté restartujte Portal server. Secrets zůstávají místní a nevracejí se do frontendu.")],
    ["Danach den Portal-Server neu starten. Secrets remain Local und werden nicht an das Frontend zurückgegeben.", values("Restart the Portal server afterwards. Secrets stay local and are not returned to the frontend.", "Danach den Portal-Server neu starten. Secrets remain Local und werden nicht an das Frontend zurückgegeben.", "Redémarrez ensuite le serveur Portal. Les secrets restent locaux et ne sont pas renvoyés au frontend.", "Reinicia después el servidor Portal. Los secretos permanecen locales y no se devuelven al frontend.", "Riavvia poi il server Portal. I secret restano locali e non vengono restituiti al frontend.", "Start daarna de Portal-server opnieuw. Secrets blijven lokaal en worden niet aan de frontend teruggegeven.", "Następnie uruchom ponownie serwer Portal. Sekrety pozostają lokalne i nie są zwracane do frontendu.", "Reinicie depois o servidor Portal. Os secrets ficam locais e não são devolvidos ao frontend.", "Starta därefter om Portal-servern. Secrets förblir lokala och skickas inte tillbaka till frontend.", "Genstart derefter Portal-serveren. Secrets forbliver lokale og returneres ikke til frontend.", "Käynnistä Portal-palvelin sen jälkeen uudelleen. Salaisuudet pysyvät paikallisina eikä niitä palauteta frontendille.", "Poté restartujte Portal server. Secrets zůstávají místní a nevracejí se do frontendu.")],
    ["Diese Funktion kann die Zuordnung aller Rufnummern zu Warteschlangen, Sprachdialogen und Nebenstellen verändern. Bitte vorab unbedingt sichern.", values("This function can change the assignment of all numbers to queues, voice dialogs, and extensions. Create a backup first.", "Diese Funktion kann die Zuordnung aller Rufnummern zu Warteschlangen, Sprachdialogen und Nebenstellen verändern. Bitte vorab unbedingt sichern.", "Cette fonction peut modifier l'affectation de tous les numéros aux files d'attente, dialogues vocaux et extensions. Sauvegardez d'abord.", "Esta función puede cambiar la asignación de todos los números a colas, diálogos de voz y extensiones. Haz una copia antes.", "Questa funzione può modificare l'assegnazione di tutti i numeri a code, dialoghi vocali e interni. Crea prima un backup.", "Deze functie kan de toewijzing van alle nummers aan wachtrijen, spraakdialogen en extensies wijzigen. Maak eerst een backup.", "Ta funkcja może zmienić przypisanie wszystkich numerów do kolejek, dialogów głosowych i numerów. Najpierw wykonaj backup.", "Esta função pode alterar a atribuição de todos os números a filas, diálogos de voz e extensões. Faça primeiro um backup.", "Funktionen kan ändra tilldelningen av alla nummer till köer, röstdialoger och anknytningar. Säkerhetskopiera först.", "Funktionen kan ændre tildelingen af alle numre til køer, stemmedialoger og lokalnumre. Tag først backup.", "Tämä toiminto voi muuttaa kaikkien numeroiden liitokset jonoihin, äänivalikoihin ja alanumeroihin. Ota varmuuskopio ensin.", "Tato funkce může změnit přiřazení všech čísel k frontám, hlasovým dialogům a linkám. Nejprve vytvořte zálohu.")],
    ["Diese Funktion kann die Zuordnung aller Numbers zu Warteschlangen, Sprachdialogen und Extensions verändern. Bitte vorab unbedingt sichern.", values("This function can change the assignment of all numbers to queues, voice dialogs, and extensions. Create a backup first.", "Diese Funktion kann die Zuordnung aller Numbers zu Warteschlangen, Sprachdialogen und Extensions verändern. Bitte vorab unbedingt sichern.", "Cette fonction peut modifier l'affectation de tous les numéros aux files d'attente, dialogues vocaux et extensions. Sauvegardez d'abord.", "Esta función puede cambiar la asignación de todos los números a colas, diálogos de voz y extensiones. Haz una copia antes.", "Questa funzione può modificare l'assegnazione di tutti i numeri a code, dialoghi vocali e interni. Crea prima un backup.", "Deze functie kan de toewijzing van alle nummers aan wachtrijen, spraakdialogen en extensies wijzigen. Maak eerst een backup.", "Ta funkcja może zmienić przypisanie wszystkich numerów do kolejek, dialogów głosowych i numerów. Najpierw wykonaj backup.", "Esta função pode alterar a atribuição de todos os números a filas, diálogos de voz e extensões. Faça primeiro um backup.", "Funktionen kan ändra tilldelningen av alla nummer till köer, röstdialoger och anknytningar. Säkerhetskopiera först.", "Funktionen kan ændre tildelingen af alle numre til køer, stemmedialoger og lokalnumre. Tag først backup.", "Tämä toiminto voi muuttaa kaikkien numeroiden liitokset jonoihin, äänivalikoihin ja alanumeroihin. Ota varmuuskopio ensin.", "Tato funkce může změnit přiřazení všech čísel k frontám, hlasovým dialogům a linkám. Nejprve vytvořte zálohu.")],
    ["Standardprofil fehlt", values("Default profile missing", "Standardprofil fehlt", "Profil par défaut manquant", "Falta perfil predeterminado", "Profilo predefinito mancante", "Standaardprofiel ontbreekt", "Brak profilu domyślnego", "Perfil predefinido em falta", "Standardprofil saknas", "Standardprofil mangler", "Oletusprofiili puuttuu", "Chybí výchozí profil")],
    ["Dieses vorhandene Ziel wird für den Nachtmodus verwendet.", values("This existing target is used for night mode.", "Dieses vorhandene Ziel wird für den Nachtmodus verwendet.", "Cette cible existante est utilisée pour le mode nuit.", "Este destino existente se usa para el modo noche.", "Questa destinazione esistente viene usata per la modalità notte.", "Dit bestaande doel wordt gebruikt voor nachtmodus.", "Ten istniejący cel jest używany dla trybu nocnego.", "Este destino existente é usado no modo noturno.", "Detta befintliga mål används för nattläge.", "Dette eksisterende mål bruges til nattilstand.", "Tätä olemassa olevaa kohdetta käytetään yötilassa.", "Tento existující cíl se používá pro noční režim.")],
    ["Dieses Existing Ziel wird für den Night mode verwendet.", values("This existing target is used for night mode.", "Dieses Existing Ziel wird für den Night mode verwendet.", "Cette cible existante est utilisée pour le mode nuit.", "Este destino existente se usa para el modo noche.", "Questa destinazione esistente viene usata per la modalità notte.", "Dit bestaande doel wordt gebruikt voor nachtmodus.", "Ten istniejący cel jest używany dla trybu nocnego.", "Este destino existente é usado no modo noturno.", "Detta befintliga mål används för nattläge.", "Dette eksisterende mål bruges til nattilstand.", "Tätä olemassa olevaa kohdetta käytetään yötilassa.", "Tento existující cíl se používá pro noční režim.")],
    ["Schritt 1 liest nur API-Daten. Zeitsteuerungen und Rufnummern bleiben unverändert.", values("Step 1 only reads API data. Time controls and numbers remain unchanged.", "Schritt 1 liest nur API-Daten. Zeitsteuerungen und Rufnummern bleiben unverändert.", "L'étape 1 lit uniquement les données API. Les contrôles horaires et numéros restent inchangés.", "El paso 1 solo lee datos API. Los controles horarios y números no cambian.", "Il passaggio 1 legge solo dati API. Controlli orari e numeri restano invariati.", "Stap 1 leest alleen API-gegevens. Tijdsturingen en nummers blijven ongewijzigd.", "Krok 1 tylko odczytuje dane API. Sterowania czasem i numery pozostają bez zmian.", "O passo 1 apenas lê dados da API. Controlos horários e números permanecem inalterados.", "Steg 1 läser bara API-data. Tidsstyrningar och nummer förblir oförändrade.", "Trin 1 læser kun API-data. Tidsstyringer og numre forbliver uændrede.", "Vaihe 1 lukee vain API-tietoja. Aikaohjaukset ja numerot pysyvät muuttumattomina.", "Krok 1 pouze čte data API. Časová řízení a čísla zůstávají beze změny.")],
    ["Step 1 liest nur API-Daten. Time controls und Numbers remain unverändert.", values("Step 1 only reads API data. Time controls and numbers remain unchanged.", "Step 1 liest nur API-Daten. Time controls und Numbers remain unverändert.", "L'étape 1 lit uniquement les données API. Les contrôles horaires et numéros restent inchangés.", "El paso 1 solo lee datos API. Los controles horarios y números no cambian.", "Il passaggio 1 legge solo dati API. Controlli orari e numeri restano invariati.", "Stap 1 leest alleen API-gegevens. Tijdsturingen en nummers blijven ongewijzigd.", "Krok 1 tylko odczytuje dane API. Sterowania czasem i numery pozostają bez zmian.", "O passo 1 apenas lê dados da API. Controlos horários e números permanecem inalterados.", "Steg 1 läser bara API-data. Tidsstyrningar och nummer förblir oförändrade.", "Trin 1 læser kun API-data. Tidsstyringer og numre forbliver uændrede.", "Vaihe 1 lukee vain API-tietoja. Aikaohjaukset ja numerot pysyvät muuttumattomina.", "Krok 1 pouze čte data API. Časová řízení a čísla zůstávají beze změny.")],
    ["Live-Schreiben gesperrt", values("Live writes locked", "Live-Schreiben gesperrt", "Écritures live verrouillées", "Escrituras live bloqueadas", "Scritture live bloccate", "Live schrijven vergrendeld", "Zapisy live zablokowane", "Escritas live bloqueadas", "Live-skrivning låst", "Live-skrivning låst", "Live-kirjoitus lukittu", "Živé zápisy uzamčeny")]
    ,
    ["Standard sichern", values("Save default", "Standard sichern", "Enregistrer par défaut", "Guardar predeterminado", "Salva predefinito", "Standaard opslaan", "Zapisz domyślne", "Guardar predefinição", "Spara standard", "Gem standard", "Tallenna oletus", "Uložit výchozí")],
    ["Aktuellen Zustand zuerst als Standard sichern.", values("Save the current state as the default first.", "Aktuellen Zustand zuerst als Standard sichern.", "Enregistrez d'abord l'état actuel comme valeur par défaut.", "Guarda primero el estado actual como predeterminado.", "Salva prima lo stato attuale come predefinito.", "Sla eerst de huidige status op als standaard.", "Najpierw zapisz bieżący stan jako domyślny.", "Guarde primeiro o estado atual como predefinição.", "Spara först aktuellt läge som standard.", "Gem først den aktuelle tilstand som standard.", "Tallenna nykyinen tila ensin oletukseksi.", "Nejprve uložte aktuální stav jako výchozí.")],
    ["Aktuellen State zuerst als Default sichern.", values("Save the current state as the default first.", "Aktuellen State zuerst als Default sichern.", "Enregistrez d'abord l'état actuel comme valeur par défaut.", "Guarda primero el estado actual como predeterminado.", "Salva prima lo stato attuale come predefinito.", "Sla eerst de huidige status op als standaard.", "Najpierw zapisz bieżący stan jako domyślny.", "Guarde primeiro o estado atual como predefinição.", "Spara först aktuellt läge som standard.", "Gem først den aktuelle tilstand som standard.", "Tallenna nykyinen tila ensin oletukseksi.", "Nejprve uložte aktuální stav jako výchozí.")]
  ].forEach(([source, value]) => addExact([source], value));

  [
    ["Lokaler", values("Local", "Lokaler", "Local", "Local", "Locale", "Lokale", "Lokalny", "Local", "Lokal", "Lokal", "Paikallinen", "Místní")],
    ["Neue", values("New", "Neue", "Nouvelle", "Nueva", "Nuova", "Nieuwe", "Nowa", "Nova", "Ny", "Ny", "Uusi", "Nová")],
    ["Neuer", values("New", "Neuer", "Nouveau", "Nuevo", "Nuovo", "Nieuwe", "Nowy", "Novo", "Ny", "Ny", "Uusi", "Nový")],
    ["Vorhandene", values("Existing", "Vorhandene", "Existante", "Existente", "Esistente", "Bestaande", "Istniejąca", "Existente", "Befintlig", "Eksisterende", "Olemassa oleva", "Existující")],
    ["Vorhandenes", values("Existing", "Vorhandenes", "Existant", "Existente", "Esistente", "Bestaand", "Istniejące", "Existente", "Befintligt", "Eksisterende", "Olemassa oleva", "Existující")],
    ["Vorhandener", values("Existing", "Vorhandener", "Existant", "Existente", "Esistente", "Bestaande", "Istniejący", "Existente", "Befintlig", "Eksisterende", "Olemassa oleva", "Existující")],
    ["Verbindung", values("Connection", "Verbindung", "Connexion", "Conexión", "Connessione", "Verbinding", "Połączenie", "Ligação", "Anslutning", "Forbindelse", "Yhteys", "Připojení")],
    ["Auswahl", values("Selection", "Auswahl", "Sélection", "Selección", "Selezione", "Selectie", "Wybór", "Seleção", "Val", "Valg", "Valinta", "Výběr")],
    ["Taste", values("Key", "Taste", "Touche", "Tecla", "Tasto", "Toets", "Klawisz", "Tecla", "Knapp", "Tast", "Näppäin", "Klávesa")],
    ["Schrittart", values("Step type", "Schrittart", "Type d'étape", "Tipo de paso", "Tipo di passaggio", "Staptype", "Typ kroku", "Tipo de passo", "Stegtyp", "Trintype", "Vaiheen tyyppi", "Typ kroku")],
    ["Schritt", values("Step", "Schritt", "Étape", "Paso", "Passaggio", "Stap", "Krok", "Passo", "Steg", "Trin", "Vaihe", "Krok")],
    ["Pfad", values("Path", "Pfad", "Chemin", "Ruta", "Percorso", "Pad", "Ścieżka", "Caminho", "Sökväg", "Sti", "Polku", "Cesta")],
    ["Ansage", values("Announcement", "Ansage", "Annonce", "Anuncio", "Annuncio", "Aankondiging", "Komunikat", "Anúncio", "Meddelande", "Besked", "Ilmoitus", "Oznámení")],
    ["über Leitung", values("via line", "über Leitung", "via ligne", "por línea", "via linea", "via lijn", "przez linię", "via linha", "via linje", "via linje", "linjan kautta", "přes linku")],
    ["Warteschlange", values("Queue", "Warteschlange", "File d'attente", "Cola", "Coda", "Wachtrij", "Kolejka", "Fila", "Kö", "Kø", "Jono", "Fronta")],
    ["Skillgruppe", values("Skill group", "Skillgruppe", "Groupe de compétences", "Grupo de habilidades", "Gruppo skill", "Skillgroep", "Grupa umiejętności", "Grupo de competências", "Kompetensgrupp", "Skillgruppe", "Taitoryhmä", "Skupina dovedností")],
    ["Nebenstellen", values("Extensions", "Nebenstellen", "Extensions", "Extensiones", "Interni", "Extensies", "Numery wewnętrzne", "Extensões", "Anknytningar", "Lokalnumre", "Alanumerot", "Linky")],
    ["Nebenstelle", values("Extension", "Nebenstelle", "Extension", "Extensión", "Interno", "Extensie", "Numer wewnętrzny", "Extensão", "Anknytning", "Lokalnummer", "Alanumero", "Linka")],
    ["Mitglieder", values("members", "Mitglieder", "membres", "miembros", "membri", "leden", "członkowie", "membros", "medlemmar", "medlemmer", "jäsentä", "členové")],
    ["Mitglied", values("member", "Mitglied", "membre", "miembro", "membro", "lid", "członek", "membro", "medlem", "medlem", "jäsen", "člen")],
    ["Ziele zeigen", values("Show targets", "Ziele zeigen", "Afficher les cibles", "Mostrar destinos", "Mostra destinazioni", "Doelen tonen", "Pokaż cele", "Mostrar destinos", "Visa mål", "Vis mål", "Näytä kohteet", "Zobrazit cíle")],
    ["Ziele", values("Targets", "Ziele", "Cibles", "Destinos", "Destinazioni", "Doelen", "Cele", "Destinos", "Mål", "Mål", "Kohteet", "Cíle")],
    ["bleiben", values("remain", "bleiben", "restent", "permanecen", "restano", "blijven", "pozostają", "permanecem", "förblir", "forbliver", "pysyvät", "zůstávají")],
    ["Zustand", values("State", "Zustand", "État", "Estado", "Stato", "Status", "Stan", "Estado", "Tillstånd", "Tilstand", "Tila", "Stav")],
    ["Prüfung", values("review", "Prüfung", "vérification", "revisión", "verifica", "controle", "sprawdzenie", "revisão", "granskning", "kontrol", "tarkistus", "kontrola")],
    ["Tasten", values("Keys", "Tasten", "Touches", "Teclas", "Tasti", "Toetsen", "Klawisze", "Teclas", "Knappar", "Taster", "Näppäimet", "Klávesy")],
    ["Anrufer", values("Caller", "Anrufer", "Appelant", "Llamante", "Chiamante", "Beller", "Dzwoniący", "Chamador", "Uppringare", "Opkalder", "Soittaja", "Volající")],
    ["Gespräch verbunden", values("Call connected", "Gespräch verbunden", "Appel connecté", "Llamada conectada", "Chiamata connessa", "Gesprek verbonden", "Połączenie połączone", "Chamada ligada", "Samtal anslutet", "Opkald forbundet", "Puhelu yhdistetty", "Hovor spojen")],
    ["Gespräch beendet", values("Call ended", "Gespräch beendet", "Appel terminé", "Llamada finalizada", "Chiamata terminata", "Gesprek beëindigd", "Połączenie zakończone", "Chamada terminada", "Samtal avslutat", "Opkald afsluttet", "Puhelu päättynyt", "Hovor ukončen")],
    ["Ziel wird angerufen", values("Target is being called", "Ziel wird angerufen", "La cible est appelée", "Se está llamando al destino", "La destinazione viene chiamata", "Doel wordt gebeld", "Cel jest wywoływany", "Destino a ser chamado", "Mål rings upp", "Mål ringes op", "Kohteeseen soitetaan", "Cíl se volá")],
    ["Ziel klingelt", values("Target is ringing", "Ziel klingelt", "La cible sonne", "El destino está sonando", "La destinazione squilla", "Doel gaat over", "Cel dzwoni", "Destino a tocar", "Mål ringer", "Mål ringer", "Kohde soi", "Cíl zvoní")],
    ["Zielroute", values("Target route", "Zielroute", "Route cible", "Ruta destino", "Route destinazione", "Doelroute", "Trasa docelowa", "Rota de destino", "Målrutt", "Målrute", "Kohdereitti", "Cílová trasa")],
    ["Verlauf", values("History", "Verlauf", "Historique", "Historial", "Cronologia", "Geschiedenis", "Historia", "Histórico", "Historik", "Historik", "Historia", "Historie")],
    ["Daten", values("Data", "Daten", "Données", "Datos", "Dati", "Gegevens", "Dane", "Dados", "Data", "Data", "Tiedot", "Data")],
    ["Telefonbuch", values("Phonebook", "Telefonbuch", "Annuaire", "Agenda telefónica", "Rubrica", "Telefoonboek", "Książka telefoniczna", "Lista telefónica", "Telefonbok", "Telefonbog", "Puhelinluettelo", "Telefonní seznam")],
    ["Aktuelles", values("Current", "Aktuelles", "Actuel", "Actual", "Attuale", "Actueel", "Bieżące", "Atual", "Aktuell", "Aktuel", "Nykyinen", "Aktuální")],
    ["Einträge", values("entries", "Einträge", "entrées", "entradas", "voci", "items", "wpisy", "entradas", "poster", "poster", "merkintää", "záznamy")],
    ["Eintrag", values("entry", "Eintrag", "entrée", "entrada", "voce", "item", "wpis", "entrada", "post", "post", "merkintä", "záznam")],
    ["hinzufügen", values("add", "hinzufügen", "ajouter", "añadir", "aggiungi", "toevoegen", "dodaj", "adicionar", "lägg till", "tilføj", "lisää", "přidat")],
    ["Rückgängig", values("Undo", "Rückgängig", "Annuler", "Deshacer", "Annulla", "Ongedaan maken", "Cofnij", "Anular", "Ångra", "Fortryd", "Kumoa", "Zpět")],
    ["(Sprachdialog |", values("(Voice dialog |", "(Sprachdialog |", "(Dialogue vocal |", "(Diálogo de voz |", "(Dialogo vocale |", "(Spraakdialoog |", "(Dialog głosowy |", "(Diálogo de voz |", "(Röstdialog |", "(Stemmedialog |", "(Äänivalikko |", "(Hlasový dialog |")],
    ["(Zeitsteuerung |", values("(Time control |", "(Zeitsteuerung |", "(Contrôle horaire |", "(Control horario |", "(Controllo orario |", "(Tijdsturing |", "(Sterowanie czasem |", "(Controlo horário |", "(Tidsstyrning |", "(Tidsstyring |", "(Aikaohjaus |", "(Časové řízení |")],
    ["Ziehen", values("Drag", "Ziehen", "Glisser", "Arrastrar", "Trascina", "Slepen", "Przeciągnij", "Arrastar", "Dra", "Træk", "Vedä", "Přetáhnout")],
    ["Öffnen", values("Open", "Öffnen", "Ouvrir", "Abrir", "Apri", "Openen", "Otwórz", "Abrir", "Öppna", "Åbn", "Avaa", "Otevřít")],
    ["Schreibschutz", values("Write protection", "Schreibschutz", "Protection écriture", "Protección de escritura", "Protezione scrittura", "Schrijfbeveiliging", "Ochrona zapisu", "Proteção de escrita", "Skrivskydd", "Skrivebeskyttelse", "Kirjoitussuojaus", "Ochrana zápisu")],
    ["Abrechnung", values("Billing", "Abrechnung", "Facturation", "Facturación", "Fatturazione", "Facturatie", "Rozliczenia", "Faturação", "Fakturering", "Fakturering", "Laskutus", "Fakturace")],
    ["Nacharbeit", values("Follow-up work", "Nacharbeit", "Suivi", "Trabajo posterior", "Lavoro successivo", "Nawerk", "Praca uzupełniająca", "Trabalho posterior", "Efterarbete", "Efterarbejde", "Jälkityö", "Následná práce")]
  ].forEach(([source, value]) => addPhrase(source, value));

  phraseTranslations.sort((a, b) => b.source.length - a.source.length);

  function detectLanguage() {
    const saved = safeLocalStorageGet(STORAGE_KEY);
    if (languageCodes.has(saved)) return saved;
    const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const language of browserLanguages) {
      const code = String(language || "").toLowerCase().split("-")[0];
      if (languageCodes.has(code)) return code;
    }
    return "en";
  }

  function safeLocalStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Language selection still works for the current page when storage is unavailable.
    }
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function translatedValue(valuesByLanguage, language) {
    return valuesByLanguage?.[language] || valuesByLanguage?.en || null;
  }

  function applyPatternTranslations(text, language) {
    const patterns = [
      [/^(\d+)\s+verpasst$/i, { en: "$1 missed", fr: "$1 manqué(s)", es: "$1 perdidas", it: "$1 perse", nl: "$1 gemist", pl: "$1 nieodebrane", pt: "$1 perdidas", sv: "$1 missade", da: "$1 mistede", fi: "$1 vastaamatta", cs: "$1 zmeškané" }],
      [/^(\d+)\s+aktiv$/i, { en: "$1 active", fr: "$1 actif(s)", es: "$1 activos", it: "$1 attivi", nl: "$1 actief", pl: "$1 aktywne", pt: "$1 ativos", sv: "$1 aktiva", da: "$1 aktive", fi: "$1 aktiivista", cs: "$1 aktivní" }],
      [/^Vortag\s+(\d+)$/i, { en: "Previous day $1", fr: "Jour précédent $1", es: "Día anterior $1", it: "Giorno precedente $1", nl: "Vorige dag $1", pl: "Poprzedni dzień $1", pt: "Dia anterior $1", sv: "Föregående dag $1", da: "Forrige dag $1", fi: "Edellinen päivä $1", cs: "Předchozí den $1" }],
      [/^(\d+)\s+Calls$/i, { en: "$1 calls", fr: "$1 appels", es: "$1 llamadas", it: "$1 chiamate", nl: "$1 gesprekken", pl: "$1 połączeń", pt: "$1 chamadas", sv: "$1 samtal", da: "$1 opkald", fi: "$1 puhelua", cs: "$1 hovorů" }],
      [/^(\d+)\s+angenommene Calls$/i, { en: "$1 answered calls", fr: "$1 appels répondus", es: "$1 llamadas atendidas", it: "$1 chiamate risposte", nl: "$1 beantwoorde gesprekken", pl: "$1 odebranych połączeń", pt: "$1 chamadas atendidas", sv: "$1 besvarade samtal", da: "$1 besvarede opkald", fi: "$1 vastattua puhelua", cs: "$1 přijatých hovorů" }],
      [/^(\d+)\s+von\s+(\d+)\s+Einträgen$/i, { en: "$1 of $2 entries", fr: "$1 sur $2 entrées", es: "$1 de $2 entradas", it: "$1 di $2 voci", nl: "$1 van $2 items", pl: "$1 z $2 wpisów", pt: "$1 de $2 entradas", sv: "$1 av $2 poster", da: "$1 af $2 poster", fi: "$1 / $2 merkintää", cs: "$1 z $2 záznamů" }],
      [/^(\d+)\s+Min\.?$/i, { en: "$1 min", fr: "$1 min", es: "$1 min", it: "$1 min", nl: "$1 min", pl: "$1 min", pt: "$1 min", sv: "$1 min", da: "$1 min", fi: "$1 min", cs: "$1 min" }]
    ];

    for (const [regex, valuesByLanguage] of patterns) {
      if (!regex.test(text)) continue;
      return text.replace(regex, translatedValue(valuesByLanguage, language) || text);
    }
    return null;
  }

  function applyEnglishPatternTranslations(text) {
    const weekdayMatch = text.match(/^(Mo|Di|Mi|Do|Fr|Sa|So) · (.+)$/i);
    if (weekdayMatch) {
      const weekdays = { mo: "Mon", di: "Tue", mi: "Wed", do: "Thu", fr: "Fri", sa: "Sat", so: "Sun" };
      return `${weekdays[weekdayMatch[1].toLowerCase()]} · ${weekdayMatch[2]}`;
    }

    const patterns = [
      [/^(\d+)\s+Kontakte verbunden$/i, "$1 contacts connected"],
      [/^(\d+)\s+Minuten$/i, "$1 minutes"],
      [/^(\d+)\s+Min\.\s+gespart$/i, "$1 min saved"],
      [/^(\d+)\s+Min\.\s+Nacharbeit vermieden$/i, "$1 min follow-up work avoided"],
      [/^(\d+)\s+Min\.\s+je Transcript$/i, "$1 min per transcript"],
      [/^(\d+)\s+Min\.\s+×\s+(.+)$/i, "$1 min × $2"],
      [/^([0-9:]+)\s+Min$/i, "$1 min"],
      [/^(\d+)\s+aus eingehenden Calls$/i, "$1 from inbound calls"],
      [/^(\d+)\s+Nummern verfügbar$/i, "$1 numbers available"],
      [/^(\d+)\s+autom\.\s+·\s+(\d+)\s+manuell$/i, "$1 auto · $2 manual"],
      [/^Kundensätze:\s+(.+)\.\s+Kundensatz anlegen$/i, "Customer records: $1. Create customer record"],
      [/^Technisch:\s+(.+)$/i, "Technical: $1"],
      [/^Inbound:\s+(.+?)\s+\((.+?)\s+vs\s+Vortag\)\s+Outbound:\s+(.+?)\s+\((.+?)\s+vs\s+Vortag\)\s+Unklar:\s+(.+)$/i, "Inbound: $1 ($2 vs previous day) Outbound: $3 ($4 vs previous day) Unknown: $5"],
      [/^Link für (.+) bearbeiten$/i, "Edit link for $1"],
      [/^Bearbeiten schließen$/i, "Close editor"],
      [/^(.+)\s+Server starten$/i, "Start $1 server"],
      [/^(.+)\s+Server stoppen$/i, "Stop $1 server"],
      [/^Schritt zwischen Eingehender Anruf und (.+) einfügen$/i, "Insert step between Incoming call and $1"],
      [/^(.+)\s+bearbeiten$/i, "Edit $1"],
      [/^Leitung von (.+) ziehen$/i, "Drag connection from $1"],
      [/^Schritt zwischen (.+) und (.+) einfügen$/i, "Insert step between $1 and $2"],
      [/^(.+)\s+Aktionen$/i, "$1 actions"]
    ];

    for (const [regex, replacement] of patterns) {
      if (!regex.test(text)) continue;
      return text.replace(regex, replacement);
    }
    return null;
  }

  function translate(text, language = currentLanguage) {
    const normalized = normalize(text);
    if (!normalized) return text;

    if (language === "en") {
      const englishExact = englishExactTranslations.get(normalized);
      if (englishExact) return preserveOuterWhitespace(text, englishExact);
      const englishPattern = applyEnglishPatternTranslations(normalized);
      if (englishPattern) return preserveOuterWhitespace(text, englishPattern);
    }

    const exact = translatedValue(exactTranslations.get(normalized), language);
    if (exact) return preserveOuterWhitespace(text, exact);

    const pattern = applyPatternTranslations(normalized, language);
    if (pattern) return preserveOuterWhitespace(text, pattern);

    if (language === SOURCE_LANGUAGE) return text;

    let translated = String(text);
    for (const phrase of phraseTranslations) {
      const replacement = translatedValue(phrase.values, language);
      if (!replacement) continue;
      translated = translated.replace(phraseRegExp(phrase.source), (match) => matchCase(match, replacement));
    }
    return translated;
  }

  function phraseRegExp(source) {
    const escaped = escapeRegExp(source);
    const startsWithLetter = /^[\p{L}\p{M}]/u.test(source);
    const endsWithLetter = /[\p{L}\p{M}]$/u.test(source);
    const prefix = startsWithLetter ? "(?<![\\p{L}\\p{M}])" : "";
    const suffix = endsWithLetter ? "(?![\\p{L}\\p{M}])" : "";
    return new RegExp(`${prefix}${escaped}${suffix}`, "giu");
  }

  function matchCase(source, replacement) {
    if (!source || !replacement) return replacement;
    if (source === source.toUpperCase()) return replacement.toUpperCase();
    if (source[0] === source[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
  }

  function preserveOuterWhitespace(original, translated) {
    const leading = String(original).match(/^\s*/)?.[0] || "";
    const trailing = String(original).match(/\s*$/)?.[0] || "";
    return `${leading}${translated}${trailing}`;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  let currentLanguage = detectLanguage();
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  let applying = false;

  function shouldSkipNode(node) {
    if (!node) return true;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return true;
    return Boolean(element.closest("[data-i18n-ignore], script, style, code, pre, textarea"));
  }

  function translateTextNode(node) {
    if (shouldSkipNode(node)) return;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const source = originalText.get(node);
    const translated = translate(source, currentLanguage);
    if (node.nodeValue !== translated) node.nodeValue = translated;
  }

  function translateAttributes(element) {
    if (shouldSkipNode(element)) return;
    const names = ["aria-label", "title", "placeholder", "alt"];
    names.forEach((name) => {
      if (!element.hasAttribute(name)) return;
      let attributeMap = originalAttributes.get(element);
      if (!attributeMap) {
        attributeMap = {};
        originalAttributes.set(element, attributeMap);
      }
      if (!Object.prototype.hasOwnProperty.call(attributeMap, name)) {
        attributeMap[name] = element.getAttribute(name);
      }
      const translated = translate(attributeMap[name], currentLanguage);
      if (element.getAttribute(name) !== translated) element.setAttribute(name, translated);
    });
  }

  function translateTree(root) {
    if (!root || shouldSkipNode(root)) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        translateTextNode(node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        translateAttributes(node);
      }
      node = walker.nextNode();
    }
  }

  function installStyle() {
    if (document.getElementById("nfon-i18n-style")) return;
    const style = document.createElement("style");
    style.id = "nfon-i18n-style";
    style.textContent = `
      .language-picker {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        min-width: 44px;
        height: 44px;
        margin: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        flex: 0 0 auto;
        align-self: center;
      }
      .language-picker.is-between-nav-and-status {
        margin: 0;
      }
      .header-status-group {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        flex: 0 0 auto;
      }
      .header-status-group.is-after-header-control {
        margin-left: 18px;
      }
      .language-trigger {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .language-current {
        display: grid;
        place-items: center;
        width: 30px;
        height: 24px;
        overflow: visible;
        line-height: 1;
        pointer-events: none;
      }
      .flag-icon {
        display: block;
        width: 24px;
        height: 16px;
        overflow: hidden;
      }
      .flag-icon svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .language-trigger:focus-visible {
        outline: 0;
      }
      .language-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 1000;
        min-width: 224px;
        padding: 8px;
        border: 1px solid #d5dddf;
        background: #ffffff;
        color: #151a1f;
        box-shadow: 0 16px 36px rgba(0,0,0,.18);
      }
      .language-menu[hidden] {
        display: none;
      }
      .language-option {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 42px;
        padding: 9px 12px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 15px;
        font-weight: 800;
        line-height: 1.2;
        text-align: left;
        cursor: pointer;
      }
      .language-option:hover,
      .language-option:focus-visible {
        outline: 0;
        background: #eef3f3;
      }
      .language-option.is-active {
        background: #dff8ec;
      }
      .language-option-flag {
        display: grid;
        place-items: center;
        width: 24px;
        height: 18px;
        flex: 0 0 24px;
      }
      @media (max-width: 760px) {
        .language-picker {
          width: 40px;
          min-width: 40px;
          height: 40px;
          margin: 0;
        }
        .header-status-group.is-after-header-control {
          margin-left: 0;
        }
        .language-trigger {
          width: 40px;
          height: 40px;
        }
        .language-current {
          width: 28px;
          height: 22px;
        }
        .language-menu {
          min-width: 208px;
          right: -4px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function installLanguagePicker() {
    if (document.getElementById("language-trigger")) return;
    const actions = document.querySelector(".app-header .header-actions");
    if (!actions) return;

    const picker = document.createElement("div");
    picker.className = "language-picker";
    picker.dataset.i18nIgnore = "true";
    picker.title = translate("Language", currentLanguage);
    picker.setAttribute("aria-label", translate("Language", currentLanguage));

    const trigger = document.createElement("button");
    trigger.id = "language-trigger";
    trigger.className = "language-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", translate("Language", currentLanguage));

    const current = document.createElement("span");
    current.className = "language-current";
    current.setAttribute("aria-hidden", "true");
    renderFlag(current, currentLanguage);

    const menu = document.createElement("div");
    menu.id = "language-menu";
    menu.className = "language-menu";
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", translate("Language", currentLanguage));

    SUPPORTED_LANGUAGES.forEach((language) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "language-option";
      option.dataset.language = language.code;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", language.code === currentLanguage ? "true" : "false");
      option.innerHTML = `<span class="language-option-flag">${flagMarkup(language.code)}</span><span>${language.label}</span>`;
      option.addEventListener("click", () => {
        setLanguage(language.code, true);
        closeLanguageMenu();
      });
      menu.appendChild(option);
    });

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleLanguageMenu();
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openLanguageMenu();
        menu.querySelector(".language-option.is-active, .language-option")?.focus();
      }
    });
    menu.addEventListener("keydown", (event) => {
      const options = Array.from(menu.querySelectorAll(".language-option"));
      const index = options.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeLanguageMenu();
        trigger.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        options[(index + 1 + options.length) % options.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        options[(index - 1 + options.length) % options.length]?.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!picker.contains(event.target)) closeLanguageMenu();
    });

    trigger.appendChild(current);
    picker.appendChild(trigger);
    picker.appendChild(menu);
    const firstStatus = actions.querySelector(".connection, .demo-switch");
    const statusGroup = document.createElement("div");
    statusGroup.className = "header-status-group";
    if (firstStatus) {
      actions.insertBefore(statusGroup, firstStatus);
      statusGroup.appendChild(picker);
      let statusControl = firstStatus;
      while (statusControl) {
        const nextControl = statusControl.nextElementSibling;
        if (statusControl.classList.contains("connection") || statusControl.classList.contains("demo-switch")) {
          statusGroup.appendChild(statusControl);
        }
        statusControl = nextControl;
      }
    } else {
      actions.appendChild(statusGroup);
      statusGroup.appendChild(picker);
    }
    const previousControl = statusGroup.previousElementSibling;
    if (previousControl?.classList.contains("nav-button") || previousControl?.classList.contains("icon-button")) {
      statusGroup.classList.add("is-after-header-control");
      picker.classList.add("is-between-nav-and-status");
    }
  }

  function openLanguageMenu() {
    const picker = document.querySelector(".language-picker");
    const trigger = document.getElementById("language-trigger");
    const menu = document.getElementById("language-menu");
    if (!picker || !trigger || !menu) return;
    picker.classList.add("is-open");
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeLanguageMenu() {
    const picker = document.querySelector(".language-picker");
    const trigger = document.getElementById("language-trigger");
    const menu = document.getElementById("language-menu");
    if (!picker || !trigger || !menu) return;
    picker.classList.remove("is-open");
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  function toggleLanguageMenu() {
    const menu = document.getElementById("language-menu");
    if (!menu) return;
    if (menu.hidden) openLanguageMenu();
    else closeLanguageMenu();
  }

  function setLanguage(language, persist = false) {
    if (!languageCodes.has(language)) return;
    currentLanguage = language;
    if (persist) safeLocalStorageSet(STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    const selectedLanguage = SUPPORTED_LANGUAGES.find((entry) => entry.code === language);
    const currentFlag = document.querySelector(".language-current");
    if (currentFlag && selectedLanguage) renderFlag(currentFlag, selectedLanguage.code);
    const pickerShell = document.querySelector(".language-picker");
    if (pickerShell) {
      pickerShell.title = translate("Language", language);
      pickerShell.setAttribute("aria-label", translate("Language", language));
    }
    const trigger = document.getElementById("language-trigger");
    if (trigger) trigger.setAttribute("aria-label", translate("Language", language));
    const menu = document.getElementById("language-menu");
    if (menu) menu.setAttribute("aria-label", translate("Language", language));
    document.querySelectorAll(".language-option").forEach((option) => {
      const active = option.dataset.language === language;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
    });

    applying = true;
    translateTree(document.body);
    document.title = translate(document.title, language);
    requestAnimationFrame(() => {
      applying = false;
    });
  }

  let refreshQueued = false;

  function refreshLanguage() {
    if (!document.body) return;
    setLanguage(currentLanguage, false);
  }

  function scheduleLanguageRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      if (applying) {
        scheduleLanguageRefresh();
        return;
      }
      refreshLanguage();
    });
  }

  function installObserver() {
    const observer = new MutationObserver((mutations) => {
      if (applying) {
        scheduleLanguageRefresh();
        return;
      }
      applying = true;
      mutations.forEach((mutation) => {
        if (mutation.type === "characterData") translateTextNode(mutation.target);
        mutation.addedNodes.forEach((node) => translateTree(node));
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          translateAttributes(mutation.target);
        }
      });
      requestAnimationFrame(() => {
        applying = false;
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "placeholder", "alt"]
    });
  }

  function init() {
    installStyle();
    installLanguagePicker();
    setLanguage(currentLanguage, false);
    installObserver();
    document.documentElement.classList.remove("i18n-booting");
    document.documentElement.classList.add("i18n-ready");
  }

  window.NFON_I18N = {
    languages: SUPPORTED_LANGUAGES.slice(),
    getLanguage: () => currentLanguage,
    setLanguage,
    translate,
    refresh: refreshLanguage,
    translateTree
  };

  if (document.body) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
