# KI-Nachhilfelehrer – Was steckt dahinter?

*Ein kurzer Überblick für alle, die verstehen wollen was hier eigentlich passiert.*

---

## Die Idee dahinter

Ich lerne seit einer Weile mit ChatGPT & Co. – und das Problem ist immer dasselbe: Die KI erklärt zwar gut, aber aus dem Internet. Das klingt erstmal nicht schlimm, bis man in der Klausur merkt, dass der Professor eine bestimmte Definition oder einen bestimmten Lösungsweg erwartet – und die KI hat einem genau den anderen beigebracht.

Also hab ich mir gedacht: Was wäre, wenn die KI *nur* mit meinen eigenen Vorlesungsunterlagen arbeitet? Kein Wikipedia, kein allgemeines Wissen – nur das, was ich selbst hochlade. Wenn etwas nicht in den Unterlagen steht, sagt die App das einfach: „Das steht nicht in deinen Dokumenten, lad das entsprechende Skript hoch."

Das war die Grundidee. Der Rest hat sich dann ziemlich schnell ergeben.

---

## Was die App kann

Man legt pro Fach ein eigenes „Fach" an (mit Emoji und Farbe, damit es nicht so trist aussieht), lädt die Vorlesungsunterlagen hoch, und kann dann direkt loslegen.

**Im Chat** erklärt die KI Themen aus den eigenen Unterlagen – mit Beispielen, Eselsbrücken, und wenn nötig auch mit automatisch generierten Diagrammen oder mathematischen Formeln. Der Stil ist bewusst so eingestellt, dass nicht einfach die Antwort hingeworfen wird, sondern dass man wirklich versteht warum etwas so funktioniert.

**Quiz & Klausuren** werden automatisch aus den Unterlagen generiert. Man kann einen Schnell-Quiz machen, eine vollständige Klausur simulieren, oder gezielt die Themen üben, bei denen man öfter Fehler macht – die App merkt sich das nämlich.

**Karteikarten** erstellt die KI ebenfalls automatisch. Und wenn man gerade Matheaufgaben löst, kann man seine handgeschriebene Lösung direkt fotografieren (oder mit dem Apple Pencil einzeichnen) und die KI bewertet sie Schritt für Schritt.

**Unterwegs** läuft die App als installierte App auf dem Handy oder iPad – also ohne Browser-Adresszeile, ohne Reload-Nerverei, auch offline benutzbar.

---

## Wie das Ganze entstanden ist

Das Projekt hab ich mit Hilfe von **Claude Code** gebaut – einem KI-Assistenten von Anthropic, der direkt im Terminal läuft und beim Programmieren hilft. Man beschreibt was man will, und er schreibt den Code, erklärt was er tut, und findet Fehler.

Das klingt nach „die KI hat das gemacht" – aber so funktioniert es nicht wirklich. Man muss genau wissen was man will, Entscheidungen treffen, Fehler erkennen und das Ergebnis testen. Claude Code ist eher wie ein sehr schneller Entwickler, dem man trotzdem erklären muss was das Ziel ist.

**Zeitraum:** ca. 3 Wochen (Mitte Mai bis Anfang Juni 2026)  
**Entwicklungsschritte (Commits):** 64  
**Codezeilen gesamt:** ~5.500

Die Entwicklung lief komplett iterativ: neue Idee → beschreiben → implementieren → auf dem iPad testen → Fehler finden → verbessern. Ein paar Bugs haben mich dabei Stunden gekostet – zum Beispiel ein CSS-Problem, bei dem der Login-Bildschirm immer über dem Chat lag, weil zwei CSS-Regeln mit gleicher Priorität sich gegenseitig überschrieben haben und die falsche gewonnen hat. Klingt klein, war aber ziemlich nervig zu finden.

---

## Was technisch dahintersteckt

Die App läuft auf einem eigenen Server (VPS bei Hetzner in Deutschland). Es gibt ein Frontend, das im Browser läuft, und ein Backend auf dem Server, das die Anfragen an die Claude-API weiterleitet und die Daten in einer PostgreSQL-Datenbank speichert.

Nutzer müssen sich registrieren und werden dann von mir freigeschaltet – ich bekomme dafür eine Telegram-Nachricht mit zwei Buttons: „Freischalten" oder „Ablehnen". Wenn ich freischalte, wird der Nutzer automatisch eingeloggt, ohne dass er nochmal etwas tun muss.

Die API-Kosten werden täglich begrenzt. Wenn jemand 90 % des Tageslimits erreicht, bekomme ich eine Warnung auf dem Handy und kann das Limit direkt per Telegram-Button erhöhen.

Passwörter werden verschlüsselt gespeichert, der API-Schlüssel liegt nur auf dem Server und ist nie im Code.

---

## Warum ich das gebaut hab

Ehrlich gesagt: weil es mich genervt hat, dass keines der bestehenden Tools genau das macht was ich brauche. ChatGPT kennt meine Unterlagen nicht. Anki ist zum Karteikarten lernen gut, aber nicht zum Erklären. Und die meisten Lern-Apps sind entweder zu allgemein oder für ein spezifisches Fach gebaut.

Diese App ist für meine Fächer, mit meinen Unterlagen, in meinem Tempo. Und weil ich sie selbst gebaut habe, kann ich sie jederzeit anpassen.

---

*Bei Fragen einfach fragen – ich erkläre gerne mehr.*
