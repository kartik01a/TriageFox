import { c, none, ticket } from "../build";

export const languages = [
  c(
    "lang-es-bug",
    ["language"],
    ["C: Hola, el botón de pagar no funciona en mi móvil, no puedo completar mi compra."],
    ticket("bug", 4),
  ),
  c(
    "lang-fr-feature",
    ["language"],
    ["C: Bonjour, serait-il possible d'ajouter un mode sombre ? Merci d'avance !"],
    ticket("feature", 2),
  ),
  c(
    "lang-de-bug",
    ["language"],
    ["C: Die App stürzt beim Öffnen der Rechnungsseite ab (Android 14). Das passiert jedes Mal."],
    ticket("bug", 3),
  ),
  c(
    "lang-pt-howto",
    ["language"],
    ["C: Olá, como altero minha senha?"],
    none(["account", "question"]),
  ),
  c(
    "lang-hinglish-bug",
    ["language"],
    ["C: Bhai app crash ho raha hai jab main payment karta hoon. iPhone pe hai, kya karu?"],
    ticket("bug", 4),
  ),
  c(
    "lang-es-praise",
    ["language"],
    ["C: ¡Me encanta la aplicación, muchas gracias por todo!"],
    none("praise"),
  ),
  c(
    "lang-ja-feature",
    ["language"],
    ["C: ダークモードを追加してほしいです。夜に使うと目が疲れます。"],
    ticket("feature", 2),
  ),
];
