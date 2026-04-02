import type { ExpertProfileOption } from "../lib/schema.js";

export function renderProfileOptions(
  select: HTMLSelectElement,
  profiles: ExpertProfileOption[],
  activeProfileId: string | null
): void {
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select expert profile";
  select.appendChild(placeholder);

  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.displayName;
    if (profile.id === activeProfileId) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}
