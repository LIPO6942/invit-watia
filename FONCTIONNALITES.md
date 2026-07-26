# 📜 Liste des Fonctionnalités — Invitation Watia Électronique (invit-watia)

Ce document répertorie l'ensemble des fonctionnalités et caractéristiques techniques intégrées dans l'application d'invitation électronique de Watia.

---

## 🌸 1. Expérience Invité & Immersion Visuelle

### ✉️ Enveloppe Virtuelle & Sceau de Cire
- **Animation 3D réaliste** d'ouverture d'enveloppe lors du clic de l'invité.
- **Sceau de cire personnalisable** (Basmala, Initiales des mariés, ou Anneaux).
- **Nom de l'invité gravé sur l'enveloppe** (Ex: *السيد علي وسيدة حرمه*).

### 🌸 Effets Visuels & Ambiance
- **Pluie de بتلات الورد (pétales de fleurs) et poussière d'or** animée en arrière-plan.
- **Thèmes de couleurs luxe** (Or Royal, Rose Poudré, Vert Émeraude, Mode Nuit/Jour).
- **Ambiance sonore automatique** avec contrôle de lecture (Musique Malouf Tunisiene, Marche Nuptiale).

---

## 📅 2. Gestion des Dates, Calendrier & Météo

### 📅 Intégration Google Calendar & Rappels (Nouveau)
- **Bouton 1-clic** pour ajouter l'événement principal dans **Google Calendar**.
- **Boutons individuels** dans le programme pour chaque étape (Contrat, Dîner, Soirée).
- **Pré-remplissage automatique** : Titre, Date/Heure, Lieu et Description.
- **Notifications de rappel intégrées** : Alerte automatique **24h avant** et **1h avant** l'événement.

### ⏰ Compte à Rebours & Horloge en Cœur
- **Décompte dynamique en temps réel** (Jours, Heures, Minutes, Secondes).
- **Horloge analogique en forme de cœur** avec aiguilles animées synchronisées sur l'heure locale.

### ☀️ Prévisions Météo du Jour J
- **Carte météo intelligente** affichant la température, l'humidité et le vent prévus pour le jour du mariage dans la ville de l'événement.

---

## 📍 3. Programme & Localisation GPS

### 🗓️ Timeline du Programme
- Affichage chronologique des étapes du mariage (Cérémonie du contrat, Accueil des invités, Séance photo, Dîner, Soirée).
- Icônes thématiques adaptées pour chaque événement.

### 🗺️ Carte Interactive Leaflet & GPS
- Fenêtre modale avec **carte géographique Leaflet**.
- Boutons directs pour ouvrir le guidage dans **Google Maps** ou **Waze**.

---

## ✍️ 4. Livre d'Or, Messages Vocaux & Confirmation (RSVP)

### 🗳️ Confirmation de Présence (RSVP Nominatif)
- Choix du nombre de personnes ou confirmation de présence en un clic.
- Enregistrement immédiat dans la base de données Firebase.

### 🎙️ Messages Vocaux (Nouveau)
- Possibilité pour les invités d'**enregistrer un message vocal** (jusqu'à 30 secondes) directement depuis leur téléphone pour la mariée.
- Écoute et prévisualisation avant envoi.

### ✍️ Livre d'Or & Suggestions de Vœux
- Envoi de félicitations écrites avec **suggestions de phrases toutes faites** en un clic.
- Carrousel de défilement dynamique des félicitations reçues.

### 📫 Boîte aux Lettres Privée (Vue Mariée / Marié)
- Accès sécurisé par paramètre (`?view=bride` ou `?view=groom`) permettant à la mariée ou au marié de lire tous les messages personnels et vocaux reçus.

---

## 📸 5. Album Photo Interactif (Pack VIP)

### 📸 Photo Stack (Album de cartes de souvenirs)
- Album de photos empilées et interactives à faire glisser.
- **Personnalisation par invité** : Possibilité d'afficher des photos spécifiques associées à un invité particulier.
- Masquage automatique de la section si aucune photo n'est associée.

---

## 🔐 6. Panneau d'Administration (`admin.html`)

### 🛠️ Gestion Complète du Mariage
- **Formulaire de configuration** : Noms des mariés, parents, date/heure, lieux, choix du thème et de la musique.
- **Gestionnaire d'événements** : Ajout/Modification des étapes de la timeline.
- **Générateur de liens WhatsApp** : Création automatique des liens d'invitation personnalisés nominatifs pour chaque invité prêts à être envoyés sur WhatsApp.
- **Suivi des compteurs & RSVP** : Visualisation en temps réel des réponses d'invités et statistiques de vue.
