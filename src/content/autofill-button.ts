import {
  EXTENSION_CONTEXT_INVALIDATED_HINT,
  isContextAlive,
} from "../lib/extension-context.js";
import { autofillLog } from "./autofill-log.js";

/** Avoid showing the chip on pages that clearly have no multi-field form. */
export function pageLooksLikeApplicationForm(): boolean {
  if (document.querySelector("#application-form, form.application--form, form#application-form")) {
    return true;
  }

  const inputs = Array.from(document.querySelectorAll("input"));
  let textLike = 0;
  for (const el of inputs) {
    if (!(el instanceof HTMLInputElement)) continue;
    const t = (el.type || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file"].includes(t)) continue;
    textLike += 1;
  }
  const textareas = document.querySelectorAll("textarea").length;
  return textLike >= 2 || textareas >= 1;
}

function removeAutofillButton(): void {
  document.getElementById("knight-devs-autofill-btn")?.remove();
}

export function injectAutofillButton(onClick: () => Promise<void>): void {
  if (document.getElementById("knight-devs-autofill-btn")) return;
  if (!pageLooksLikeApplicationForm()) return;

  const button = document.createElement("button");
  button.id = "knight-devs-autofill-btn";
  button.type = "button";
  button.textContent = "Autofill with Knight Devs";
  button.style.position = "fixed";
  button.style.right = "16px";
  button.style.bottom = "16px";
  button.style.zIndex = "2147483647";
  button.style.padding = "10px 14px";
  button.style.borderRadius = "8px";
  button.style.border = "none";
  button.style.background = "#2f6feb";
  button.style.color = "#fff";
  button.style.cursor = "pointer";
  button.style.fontSize = "13px";
  button.style.boxShadow = "0 2px 12px rgba(0,0,0,.2)";

  button.addEventListener("click", () => {
    autofillLog("Floating button: clicked (starting autofill)", {});
    if (!isContextAlive()) {
      removeAutofillButton();
      console.warn("Knight Devs Autofill:", EXTENSION_CONTEXT_INVALIDATED_HINT);
      autofillLog("Floating button: context dead, removed button", {});
      return;
    }
    void onClick().catch(() => {
      removeAutofillButton();
    });
  });

  document.body.appendChild(button);
}
