(() => {
  try {
    const storageKey = "lambenti-theme";
    const storedTheme = window.localStorage.getItem(storageKey);
    const theme = storedTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
