import { AuthClient, type AuthState } from "../net/AuthClient";

type Tab = "login" | "register";

export class AuthScreen {
  private tab: Tab = "login";

  constructor(
    private readonly root: HTMLElement,
    private readonly onDone: (state: AuthState) => void,
  ) {
    this.render();
  }

  private render(): void {
    this.root.innerHTML = "";
    const wrap = el("div", "screen-center");
    const panel = el("div", "panel");

    const title = el("h1", "title");
    title.textContent = "Little Brawlers";
    panel.appendChild(title);

    // Tab bar
    const tabs = el("div", "auth-tabs");
    const loginTab = el("button", `auth-tab${this.tab === "login" ? " active" : ""}`);
    loginTab.textContent = "Log in";
    loginTab.onclick = () => { this.tab = "login"; this.render(); };
    const regTab = el("button", `auth-tab${this.tab === "register" ? " active" : ""}`);
    regTab.textContent = "Register";
    regTab.onclick = () => { this.tab = "register"; this.render(); };
    tabs.appendChild(loginTab);
    tabs.appendChild(regTab);
    panel.appendChild(tabs);

    const status = el("p", "status-text");
    panel.appendChild(status);
    const setStatus = (msg: string, isError = true) => {
      status.textContent = msg;
      status.style.color = isError ? "#e74c3c" : "#2ecc71";
    };

    if (this.tab === "login") {
      const idInput = input("text-input", "Username or email");
      const pwInput = input("text-input", "Password", "password");
      panel.appendChild(idInput);
      panel.appendChild(pwInput);

      const btn = el("button", "primary-button") as HTMLButtonElement;
      btn.textContent = "Log in";
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "Logging in…";
        try {
          const state = await AuthClient.login(idInput.value.trim(), pwInput.value);
          this.onDone(state);
        } catch (err) {
          setStatus((err as Error).message);
          btn.disabled = false;
          btn.textContent = "Log in";
        }
      };
      panel.appendChild(btn);
    } else {
      const nameInput = input("text-input", "Username (3–20 chars)");
      const emailInput = input("text-input", "Email", "email");
      const pwInput = input("text-input", "Password (min 8 chars)", "password");
      const pw2Input = input("text-input", "Confirm password", "password");
      panel.appendChild(nameInput);
      panel.appendChild(emailInput);
      panel.appendChild(pwInput);
      panel.appendChild(pw2Input);

      const btn = el("button", "primary-button") as HTMLButtonElement;
      btn.textContent = "Create account";
      btn.onclick = async () => {
        if (pwInput.value !== pw2Input.value) { setStatus("Passwords don't match"); return; }
        btn.disabled = true;
        btn.textContent = "Creating…";
        try {
          const state = await AuthClient.register(nameInput.value.trim(), emailInput.value.trim(), pwInput.value);
          this.onDone(state);
        } catch (err) {
          setStatus((err as Error).message);
          btn.disabled = false;
          btn.textContent = "Create account";
        }
      };
      panel.appendChild(btn);
    }

    const divider = el("div", "divider");
    divider.textContent = "or play without an account";
    panel.appendChild(divider);

    const guestNameInput = input("text-input code-input", "Guest name");
    guestNameInput.maxLength = 20;
    panel.appendChild(guestNameInput);

    const guestBtn = el("button", "secondary-button") as HTMLButtonElement;
    guestBtn.textContent = "Play as Guest";
    guestBtn.onclick = () => {
      const name = guestNameInput.value.trim();
      if (!name) { setStatus("Enter a guest name first"); return; }
      this.onDone({ username: name });
    };
    panel.appendChild(guestBtn);

    wrap.appendChild(panel);
    this.root.appendChild(wrap);
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function input(className: string, placeholder: string, type = "text"): HTMLInputElement {
  const e = document.createElement("input");
  e.className = className;
  e.type = type;
  e.placeholder = placeholder;
  e.style.marginTop = "8px";
  return e;
}
