# Huginn

[Huginn](https://github.com/huginn/huginn) ist ein freies, selbst gehostetes
System von Agenten, die das Web für dich beobachten und auf das reagieren, was
sie finden: eine Seite, die sich ändert, ein RSS-Feed, ein Preis, das Wetter,
eine E-Mail, ein Webhook. Jeder Agent erzeugt **Ereignisse**, die andere
Agenten weitergeben. Diese Integration bringt deine Agenten in Gladys: Jeder
wird zu einem Gerät (funktioniert, letztes Ereignis, gespeicherte Ereignisse,
Fehlermeldung), Szenen reagieren, wenn **irgendein** Agent ein Ereignis erzeugt
oder fehlerhaft wird, Gladys kann ein Ereignis an einen Webhook Agent senden
oder einen Agenten ausführen, und ein Widget im Dashboard listet die letzten
Ereignisse.

Getestet mit einem echten Huginn (Docker-Image `ghcr.io/huginn/huginn`); noch
nicht auf jeder Installation: Rückmeldungen sind willkommen in
[den Issues](https://github.com/guim31/gladys-huginn/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Huginn, erreichbar von der Gladys-Maschine (im lokalen Netzwerk oder im
  Internet per HTTPS).
- Ein Huginn-Konto: seinen Benutzernamen (oder seine E-Mail) und sein Passwort.

Huginn hat keinen API-Schlüssel: Die Integration meldet sich mit dem Konto an,
wie dein Browser, und liest die Seiten der Oberfläche als JSON. Dabei sieht
sie nur die Agenten dieses Kontos. Ein eigenes Konto geht auch, solange die zu
verfolgenden Agenten ihm gehören.

## Erste Schritte

### 1. Das Konto wählen

Nimm dein eigenes Huginn-Konto oder erstelle eines für Gladys (seine Agenten
sind die, die Gladys sieht). Die Integration ändert nie einen Agenten, außer
ihn auszuführen, wenn eine Szene es verlangt.

### 2. Die Integration konfigurieren

Öffne in Gladys die Integration und dann den Tab **Konfiguration**:

- **Huginn-Adresse**: die Adresse, mit der du Huginn öffnest, mit Port, zum
  Beispiel `http://192.168.1.2:3000`. Eine aus dem Browser kopierte Adresse
  geht auch.
- **Benutzername oder E-Mail** und **Passwort**: das Konto von oben.
- **Aktualisierungsintervall**: wie oft Gladys Huginn liest (standardmäßig
  1 Minute). Drei Anfragen pro Abfrage, wenn nichts passiert ist, ein paar mehr
  nach neuen Ereignissen.
- **Selbstsignierte Zertifikate akzeptieren**: nur für eine `https://`-Adresse,
  deren Zertifikat auch dein Browser nicht akzeptiert.
- **Sprache der Namen**: die Sprache der Funktionsnamen, der Daten und der
  Szenenergebnisse (standardmäßig Französisch).

Speichere und klicke dann auf **Verbindung testen**: Der Test zeigt die Anzahl der
Agenten, die fehlerhaften und die Ereignisse der letzten 24 Stunden.

Ein abgelehntes Passwort wird **einmal** versucht: Huginn sperrt ein Konto nach
10 fehlgeschlagenen Anmeldungen. Die Integration versucht es erneut, wenn du
die Konfiguration speicherst oder auf **Verbindung testen** klickst.

### 3. Die Agenten hinzufügen

Der Tab **Entdecken** listet ein Gerät **Huginn** und ein Gerät pro Agent. Füge
die hinzu, die du in Gladys sehen willst. Die Szenenauslöser funktionieren für
jeden Agenten, hinzugefügt oder nicht.

## Die Geräte

Jeder Agent hat:

- **Funktioniert**: an, solange der Agent keinen neuen Fehler hat (ein Fehler,
  der nach seinem letzten Ereignis protokolliert wurde oder weniger als
  2 Minuten davor, so wie Huginn ihn zählt).
- **Letztes Ereignis**: ein kurzer Auszug seines letzten Ereignisses (sein
  Titel, seine Nachricht oder sein Text, sonst sein Inhalt als JSON).
- **Datum des letzten Ereignisses**: Datum und Uhrzeit seines letzten
  Ereignisses.
- **Gespeicherte Ereignisse**: die Ereignisse, die Huginn für diesen Agenten
  aufbewahrt (sie laufen nach der am Agenten eingestellten Dauer ab).
- **Fehlermeldung**: die erste Zeile seines neuesten Fehlers, solange er
  fehlerhaft ist, sonst „Keiner“.

Das Gerät **Huginn** zählt die **Agenten**, die **Fehlerhafte Agenten**, die
**Deaktivierte Agenten**, die **Ereignisse in 24 h** und die **Fehlgeschlagene Jobs (5 Tage)** (die fehlgeschlagenen Hintergrundaufgaben von Huginn, alle
Konten zusammen).

## Dashboard

Das Widget **Huginn-Ereignisse** zeigt die Ereignisse der letzten 24 Stunden
und die fehlerhaften Agenten, dann eine Zeile pro Agent, das neueste Ereignis
zuerst: Name, Auszug seines letzten Ereignisses (oder sein Fehler), Datum und
ein Abzeichen „Fehler“. Die fehlerhaften Agenten stehen oben. Ein Tippen auf
eine Zeile öffnet die Details.

In seinen Einstellungen beschränkt **Agenten** es auf die Geräte deiner Wahl
(nur zu Gladys hinzugefügte Geräte sind wählbar); die Kachel der 24 Stunden
verschwindet dann, sie zählt die ganze Instanz.

## Szenen

### Auslöser

Jeder Agent löst sie aus, zu Gladys hinzugefügt oder nicht. Lass
**Agenten** leer, um auf jeden zu reagieren, oder wähle welche aus.

- **Ein Agent erzeugt ein Ereignis**: Ein Huginn-Agent hat ein Ereignis
  erzeugt. Variablen: Name des Agenten, Auszug (höchstens 500 Zeichen), Inhalt
  (das Ereignis als JSON, höchstens 1000 Zeichen), Nummer des Ereignisses.
  Höchstens 20 Ereignisse pro Abfrage, die neuesten: Ein Agent, der Hunderte
  auf einmal erzeugt, überflutet Gladys nicht.
- **Ein Agent wird fehlerhaft**: Ein Agent hat einen Fehler protokolliert und
  seitdem kein Ereignis erzeugt. Einmal, bis er wieder funktioniert. Variablen:
  Name des Agenten, Fehlermeldung.
- **Huginn ist nicht erreichbar**: Huginn antwortet nicht mehr (zwei
  fehlgeschlagene Abfragen in Folge). Variable: der Grund.
- **Huginn antwortet wieder**: Huginn antwortet wieder, mit der Dauer des
  Ausfalls in Minuten.

Ein Ereignis, das während eines Neustarts von Gladys oder der Integration
entsteht, wird trotzdem angekündigt, einmal. Bei der allerersten Abfrage wird
nichts angekündigt.

### Aktionen

- **Ein Ereignis an Huginn senden**: sendet einen Text an einen **Webhook
  Agent**, der daraus ein Huginn-Ereignis macht. Ein JSON-Objekt wird
  unverändert gesendet (`{"raum": "Wohnzimmer"}`), jeder andere Text als
  `{"text": "…"}`. Werte der Szene können eingefügt werden. Ausgaben:
  angenommen, HTTP-Status, Antwort von Huginn. Der Agent muss `post` in seinen
  `verbs` annehmen (Standard). Die Adresse des Webhooks mit seinem Secret wird
  vom Agenten gelesen: nichts zu kopieren.
- **Huginn-Agenten ausführen**: Huginn prüft den Agenten jetzt (eine Seite,
  einen Feed, eine Zusammenfassung), statt auf seinen Zeitplan zu warten. Seine
  Ereignisse lösen dann bei der nächsten Abfrage die Auslöser oben aus.
- **Letztes Ereignis eines Agenten**: liest das letzte Ereignis eines Agenten
  für die nächsten Aktionen. Ausgaben: Auszug, Inhalt (JSON), Datum
  (ISO 8601), funktioniert, Fehlermeldung und ein fertiger Satz („Agent:
  Auszug“).

### Ideen für Szenen

- **Preisbeobachtung**: Auslöser „Ein Agent erzeugt ein Ereignis“ auf einem
  Website Agent, der einen Preis verfolgt → eine Nachricht „💶 …“ mit dem
  „Auszug“ senden.
- **Gladys füttert Huginn**: wenn die Alarmanlage angeht → „Ein Ereignis an Huginn senden“ mit `{"alarm": "an", "zeit": "…"}`; ein Huginn-Szenario
  speichert es oder fügt es der Abendzusammenfassung hinzu.
- **Kaputter Agent**: Auslöser „Ein Agent wird fehlerhaft“ → eine Nachricht
  „⚠️ Huginn: … (…)“ mit „Name des Agenten“ und „Fehlermeldung“ senden.
- **Morgenbericht**: jeden Tag um 7:30 → „Huginn-Agenten ausführen“ auf dem
  Wetter-Agenten, dann eine Minute später „Letztes Ereignis eines Agenten“ →
  den „Satz“ sagen.

## Fehlerbehebung

- **„Anmeldung abgelehnt“**: Prüfe den Benutzernamen (oder die E-Mail) und das
  Passwort und speichere dann. „Your account is locked“ in den Protokollen der
  Integration: Huginn hat das Konto nach zu vielen Fehlversuchen gesperrt;
  entsperre es (per E-Mail oder warte eine Stunde) und speichere dann.
- **„Huginn antwortet nicht“**: Prüfe Adresse und Port (standardmäßig 3000) von
  der Gladys-Maschine aus. `localhost` ist der Container der Integration
  selbst: Nimm die IP-Adresse der Maschine, auf der Huginn läuft.
- **„Zertifikat abgelehnt“**: Das HTTPS-Zertifikat ist selbstsigniert oder
  abgelaufen; aktiviere „Selbstsignierte Zertifikate akzeptieren“ oder nimm die
  `http://`-Adresse im lokalen Netzwerk.
- **„Kein Huginn unter dieser Adresse“**: Die Adresse zeigt auf einen anderen
  Dienst oder auf einen Unterpfad, der nicht der von Huginn ist.
- **„Die Adresse leitet um“**: Gib die `https://`-Adresse ein.
- **„Dieser Agent ist kein Webhook Agent“**: „Ein Ereignis an Huginn senden“
  braucht einen Webhook Agent (einen Agenten mit einer Option `secret`).
- **„Huginn hat das Ereignis abgelehnt (HTTP 401)“**: Das Secret des Webhook
  Agent hat sich geändert; die Integration liest es bei der nächsten Abfrage
  neu, versuche es erneut.
- **„Funktioniert“ bleibt aus**: Der Agent hat nach seinem letzten Ereignis
  einen Fehler protokolliert. Öffne seine Protokolle in Huginn; es geht bei
  seinem nächsten Ereignis wieder an.

## Grenzen

- Huginn hat keine REST-API: Die Integration liest die JSON-Seiten der
  Weboberfläche mit einer Sitzung. Eine künftige Huginn-Version könnte sie
  ändern.
- Ein Agent eines anderen Kontos wird nicht gesehen; die fehlgeschlagenen Jobs
  werden für die ganze Instanz gezählt.
- „Funktioniert“ folgt nur den protokollierten Fehlern; die Spalte „Working?“
  von Huginn prüft bei manchen Agententypen auch, ob Ereignisse oft genug
  ankommen.
- Höchstens 8 Seiten mit 25 neuen Ereignissen werden pro Aktualisierung
  gelesen: Darüber hinaus werden die Ereignisse gezählt, aber weder angekündigt
  noch ausgezogen.
- Die Ereignisse der letzten 24 Stunden werden pro Stunde gezählt (die älteste
  Stunde zählt ganz).
- Agenten werden in Huginn erstellt, bearbeitet und gelöscht; Gladys sendet nur
  Ereignisse an Webhook Agents und führt Agenten aus.
