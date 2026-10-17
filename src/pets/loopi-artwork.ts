/** Trusted, shared artwork for the built-in Loopi renderer and thumbnail. */
export function renderLoopiSvg(key: string): string {
  return `<svg viewBox="0 0 400 400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<style>.loopi-pet-work-card,.loopi-pet-happy-eyes,.loopi-pet-happy-mouth,.loopi-pet-wait-cue{opacity:0}.loopi-pet-happy-mouth{fill:#232832}</style>
<defs>
<linearGradient id="gray-${key}" x1="85" y1="65" x2="270" y2="334" gradientUnits="userSpaceOnUse"><stop stop-color="#83858a"/><stop offset=".22" stop-color="#5a5c61"/><stop offset=".6" stop-color="#45474b"/><stop offset="1" stop-color="#33363a"/></linearGradient>
<linearGradient id="blue-${key}" x1="210" y1="51" x2="332" y2="176" gradientUnits="userSpaceOnUse"><stop stop-color="#7bbaff"/><stop offset=".27" stop-color="#369bff"/><stop offset=".68" stop-color="#087dff"/><stop offset="1" stop-color="#0064dd"/></linearGradient>
<radialGradient id="pearl-${key}" cx=".32" cy=".22" r=".85"><stop stop-color="#fffefa"/><stop offset=".5" stop-color="#f6f3f0"/><stop offset=".8" stop-color="#e7e4e1"/><stop offset="1" stop-color="#c9c9cb"/></radialGradient>
<radialGradient id="eyes-${key}" cx=".3" cy=".25" r=".8"><stop stop-color="#4d5056"/><stop offset=".45" stop-color="#20232a"/><stop offset="1" stop-color="#090d14"/></radialGradient>
<filter id="blur-${key}" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="soft-${key}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.8"/></filter>
<path id="long-${key}" d="M324.09 211.88 A126 126 0 1 1 178.12 65.91"/>
<path id="short-${key}" d="M230.48 67.74 A126 126 0 0 1 322.26 159.52"/>
</defs>
<ellipse class="loopi-pet-ground" cx="200" cy="352" rx="86" ry="7" fill="#334259" opacity=".14" filter="url(#blur-${key})"/>
<g class="loopi-pet-body-motion">
<g class="loopi-pet-ring" fill="none" stroke-width="44" stroke-linecap="round">
<g transform="translate(0 3)"><use href="#long-${key}" stroke="#303237"/><use href="#short-${key}" stroke="#0063d6"/></g>
<use href="#long-${key}" stroke="url(#gray-${key})"/><use href="#short-${key}" stroke="url(#blue-${key})"/>
<g transform="translate(-2 -7)" stroke-width="9" opacity=".19" filter="url(#soft-${key})"><use href="#long-${key}" stroke="#fff"/><use href="#short-${key}" stroke="#e0f1ff"/></g>
</g>
<path class="loopi-pet-wait-cue" d="M230.48 67.74 A126 126 0 0 1 322.26 159.52" fill="none" stroke="#a4d4ff" stroke-width="2" stroke-linecap="round"/>
<g class="loopi-pet-core-motion"><circle cx="200" cy="193" r="75" fill="#384353" opacity=".08" filter="url(#blur-${key})"/>
<circle cx="200" cy="190" r="75" fill="url(#pearl-${key})"/><path d="M140 160 A69 69 0 0 1 231 129" stroke="#fff" stroke-width="2" opacity=".48" fill="none" stroke-linecap="round"/>
<g class="loopi-pet-look"><g class="loopi-pet-cheeks" fill="#f0b8a0" filter="url(#soft-${key})"><ellipse cx="160" cy="208" rx="9" ry="5"/><ellipse cx="240" cy="208" rx="9" ry="5"/></g>
<g class="loopi-pet-eyes"><g class="loopi-pet-normal-eyes"><ellipse cx="174" cy="184" rx="7.8" ry="10.3" fill="url(#eyes-${key})"/><ellipse cx="226" cy="184" rx="7.8" ry="10.3" fill="url(#eyes-${key})"/><ellipse cx="176" cy="180" rx="2.1" ry="2.8" fill="white"/><ellipse cx="228" cy="180" rx="2.1" ry="2.8" fill="white"/></g>
<g class="loopi-pet-happy-eyes" stroke="#242830" fill="none" stroke-width="4" stroke-linecap="round"><path d="M165 186 Q174 173 183 186"/><path d="M217 186 Q226 173 235 186"/></g></g>
<path class="loopi-pet-normal-mouth" d="M190 207 Q200 217 210 207" stroke="#292c33" stroke-width="3.8" stroke-linecap="round" fill="none"/>
<g class="loopi-pet-happy-mouth"><path d="M188 204 Q200 211 212 204 Q210 225 200 223 Q190 222 188 204"/><path d="M194 218 Q200 213 206 218 Q200 224 194 218" fill="#f3a79f"/></g>
</g></g>
<g class="loopi-pet-work-card"><path d="M266 224 L322 217 Q327 216 325 222 L314 259 Q313 262 309 263 L255 269 Q251 270 253 265Z" fill="#c7cdd7" transform="translate(0 3)"/><path d="M266 224 L322 217 Q327 216 325 222 L314 259 Q313 262 309 263 L255 269 Q251 270 253 265Z" fill="#fbfcfe" stroke="#e0e4eb"/><path d="M273 235 L312 230 M270 243 L306 239 M267 252 L290 249" stroke="#c2d0e0" stroke-width="2.5" stroke-linecap="round"/><path class="loopi-pet-scan" d="M273 235 L296 232" stroke="#2588f4" stroke-width="2.5" stroke-linecap="round"/></g>
</g></svg>`;
}
