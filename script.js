"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  user: null,
  claims: [],
  items: [],
  editingId: null,
  viewing: null,
  dropdowns: { costCenters: [], currencies: ["SAR", "USD", "EUR", "AED"], invoiceNames: [], itemDescriptions: [], purposes: [], categories: [] }
};
let claims = [];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const money = (amount, currency = "SAR") => `${safe(currency || "SAR")} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const total = claim => (claim.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
const claimTotal = claim => total(claim);
const escapeHTML = value => safe(value);
const showToast = (message, type) => toast(message, type);
const localDateInputValue = () => today();
document.querySelectorAll('input[type="password"]').forEach(input => {
  const wrapper = document.createElement("span");
  wrapper.className = "password-input-wrap";
  input.parentNode.insertBefore(wrapper, input);
  wrapper.append(input);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "password-visibility-toggle";
  toggle.setAttribute("aria-label", "Show password");
  toggle.setAttribute("aria-pressed", "false");
  toggle.title = "Show password";
  toggle.innerHTML = '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
  const setVisible = reveal => {
    input.type = reveal ? "text" : "password";
    toggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(reveal));
    toggle.title = reveal ? "Hide password" : "Show password";
    toggle.innerHTML = `<i class="fa-solid fa-eye${reveal ? "-slash" : ""}" aria-hidden="true"></i>`;
  };
  toggle.addEventListener("pointerdown", event => {
    event.preventDefault();
    if (toggle.setPointerCapture) toggle.setPointerCapture(event.pointerId);
    setVisible(true);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture", "pointerleave", "blur"]) {
    toggle.addEventListener(name, () => setVisible(false));
  }
  toggle.addEventListener("keydown", event => {
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); setVisible(true); }
  });
  toggle.addEventListener("keyup", event => {
    if (event.key === " " || event.key === "Enter") setVisible(false);
  });
  toggle.addEventListener("contextmenu", event => event.preventDefault());
  wrapper.append(toggle);
});
window.addEventListener("blur", () => document.querySelectorAll(".password-visibility-toggle").forEach(button => button.dispatchEvent(new Event("blur"))));
function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short" }).toUpperCase();
  return `${day}-${month}-${date.getFullYear()}`;
}
function openModal(id) { $(`#${id}`)?.classList.add("show"); }
let toastTimer;
let editingItemIndex = null;

// The claim reference is intentionally one editable field (name or number).
$("#claimNumber")?.closest(".form-group")?.remove();
$("#claimName").previousElementSibling.innerHTML = "Claim name / number";
$("#claimName").placeholder = "Type any claim name or number";
const claimFullscreenButton = document.createElement("button");
claimFullscreenButton.id = "claimFullscreenBtn";
claimFullscreenButton.type = "button";
claimFullscreenButton.className = "modal-close modal-expand";
claimFullscreenButton.title = "Expand form";
claimFullscreenButton.setAttribute("aria-label", "Expand claim form");
claimFullscreenButton.innerHTML = `<i class="fa-solid fa-expand"></i>`;
$("#closeClaimModal").before(claimFullscreenButton);
claimFullscreenButton.addEventListener("click", () => {
  const expanded = $("#claimModal").classList.toggle("is-fullscreen");
  claimFullscreenButton.innerHTML = `<i class="fa-solid fa-${expanded ? "compress" : "expand"}"></i>`;
  claimFullscreenButton.title = expanded ? "Restore form size" : "Expand form";
  claimFullscreenButton.setAttribute("aria-label", expanded ? "Restore claim form size" : "Expand claim form");
});

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Request failed (${response.status}).`);
  return result;
}
function toast(message, type = "success") {
  const element = $("#toast");
  element.textContent = message;
  element.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = ""; }, 3200);
}
function showAuthMessage(message) {
  $("#authMessage").textContent = message || "";
  $("#authMessage").className = message ? "message-error" : "";
}
function setAuthMode(register) {
  $("#loginForm").classList.toggle("hidden", register);
  $("#registerForm").classList.toggle("hidden", !register);
  $("#resetPasswordForm").classList.add("hidden");
  $("#forgotPasswordBtn").classList.toggle("hidden", register);
  $(".auth-switch").classList.remove("hidden");
  $("#authSwitchText").textContent = register ? "Already have an account?" : "New to Expense Claim?";
  $("#authSwitchBtn").textContent = register ? "Log in" : "Create an account";
  $(".auth-card h1").textContent = register ? "Create your account" : "Expense Claim";
  showAuthMessage("");
}
function showApp(user) {
  state.user = user;
  $("#authPage").classList.add("hidden");
  $("#appPage").classList.remove("hidden");
  $("#sidebarUserEmail").textContent = user.email;
  $("#userAvatar").textContent = user.email.charAt(0).toUpperCase();
  renderAccountProfile(user);
  const date = new Date();
  $("#todayLabel").textContent = date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  $("#pageTitle").innerHTML = `Good ${date.getHours() < 12 ? "morning" : date.getHours() < 18 ? "afternoon" : "evening"} <span class="wave">✦</span>`;
  refreshAll();
}

function renderAccountProfile(user = state.user || {}) {
  const profile = user.profile || {};
  const displayName = profile.fullName || "Profile not set up";
  $("#profileDisplayName").textContent = displayName;
  $("#profileDisplayEmail").textContent = user.email || "";
  $("#profileDisplayRole").textContent = profile.jobTitle || "";
  $("#profileBadge").textContent = (profile.fullName || user.email || "U").charAt(0).toUpperCase();
  const details = [["Address", profile.address], ["City", profile.city], ["Country", profile.country]].filter(([, value]) => value);
  $("#profileDetails").innerHTML = details.length ? details.map(([label, value]) => `<div><dt>${safe(label)}</dt><dd>${safe(value)}</dd></div>`).join("") : `<p class="account-note">No additional profile details yet.</p>`;
  const form = $("#profileForm");
  if (form) for (const field of ["fullName", "jobTitle", "address", "city", "country"]) form.elements[field].value = profile[field] || "";
  if ($("#settingsEmail")) $("#settingsEmail").value = user.email || "";
}

$("#forgotPasswordBtn").addEventListener("click", () => {
  $("#loginForm").classList.add("hidden");
  $("#registerForm").classList.add("hidden");
  $("#forgotPasswordBtn").classList.add("hidden");
  $(".auth-switch").classList.add("hidden");
  $(".auth-card h1").textContent = "Reset your password";
  $("#resetPasswordForm").classList.remove("hidden");
  $("#resetEmail").value = $("#loginEmail").value;
  showAuthMessage("");
});
$("#resetPasswordForm").addEventListener("submit", async event => {
  event.preventDefault();
  const password = $("#resetNewPassword").value;
  if (password !== $("#resetConfirmPassword").value) return showAuthMessage("The passwords do not match.");
  const body = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const data = await api("/api/auth/reset-password", { method: "POST", body: JSON.stringify(body) });
    $("#loginEmail").value = body.email;
    $("#loginPassword").value = "";
    setAuthMode(false);
    showAuthMessage(data.message);
  } catch (error) { showAuthMessage(error.message); }
});

$("#profileForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const data = await api("/api/profile", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    state.user = data.user;
    renderAccountProfile(data.user);
    toast(data.message);
  } catch (error) { toast(error.message, "error"); }
});
$("#emailSettingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const data = await api("/api/account/email", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    state.user = data.user;
    $("#sidebarUserEmail").textContent = data.user.email;
    $("#userAvatar").textContent = data.user.email.charAt(0).toUpperCase();
    renderAccountProfile(data.user);
    event.currentTarget.reset();
    toast(data.message);
  } catch (error) { toast(error.message, "error"); }
});
$("#passwordSettingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  if ($("#settingsNewPassword").value !== $("#settingsConfirmPassword").value) return toast("The passwords do not match.", "error");
  const body = { currentPassword: $("#passwordCurrentPassword").value, newPassword: $("#settingsNewPassword").value };
  try {
    const data = await api("/api/account/password", { method: "PUT", body: JSON.stringify(body) });
    event.currentTarget.reset();
    toast(data.message);
  } catch (error) { toast(error.message, "error"); }
});
$("#recoveryCodeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("button[type=submit]", event.currentTarget);
  button.disabled = true;
  $("#recoveryCodeResult").classList.add("hidden");
  try {
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const data = await api("/api/account/recovery-code", { method: "POST", body: JSON.stringify(body) });
    $("#recoveryCodeResult").innerHTML = `<strong>${safe(data.recoveryCode)}</strong><span>${safe(data.message)}</span>`;
    $("#recoveryCodeResult").classList.remove("hidden");
    event.currentTarget.reset();
  } catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; }
});

$("#authSwitchBtn").addEventListener("click", () => setAuthMode(!$("#loginForm").classList.contains("hidden")));
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("button[type=submit]", event.currentTarget);
  button.disabled = true;
  try {
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    showApp(data.user);
  } catch (error) { showAuthMessage(error.message); }
  finally { button.disabled = false; }
});
$("#registerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("button[type=submit]", event.currentTarget);
  button.disabled = true;
  try {
    const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    showApp(data.user);
  } catch (error) { showAuthMessage(error.message); }
  finally { button.disabled = false; }
});
$("#logoutBtn").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); }
  catch (error) { toast(error.message, "error"); }
  state.user = null;
  $("#appPage").classList.add("hidden");
  $("#authPage").classList.remove("hidden");
  $("#loginForm").reset();
  setAuthMode(false);
});

async function refreshAll() {
  try {
    const [claimData, dropdownData] = await Promise.all([api("/api/claims"), api("/api/dropdowns")]);
    state.claims = claimData.claims || [];
    claims = state.claims.map(claim => ({
      ...claim,
      id: String(claim._id),
      claimName: claim.name || claim.number || "Expense claim",
      claimDate: claim.date || "",
      items: (claim.items || []).map(item => ({ ...item, invoiceDate: item.invoiceDate || item.date || "" }))
    }));
    if (dropdownData.dropdowns) state.dropdowns = { ...state.dropdowns, ...dropdownData.dropdowns };
    for (const key of Object.keys(state.dropdowns)) if (!Array.isArray(state.dropdowns[key])) state.dropdowns[key] = [];
    renderClaims();
    renderDropdowns();
  } catch (error) {
    toast(error.message, "error");
    if (/log in|session/i.test(error.message)) {
      $("#appPage").classList.add("hidden");
      $("#authPage").classList.remove("hidden");
    }
  }
}
function claimRow(claim, compact = false) {
  const id = safe(claim._id);
  return `<tr data-claim-id="${id}">
    <td><div class="claim-cell"><span class="claim-file"><i class="fa-regular fa-file-lines"></i></span><span><strong>${safe(claim.name || claim.number || "Expense claim")}</strong>${claim.number && claim.number !== claim.name ? `<small>${safe(claim.number)}</small>` : ""}</span></div></td>
    <td>${safe(claim.costCenter || "—")}</td><td>${safe(claim.date || "—")}</td>
    <td>${(claim.items || []).length} items</td><td class="amount-cell">${money(total(claim), claim.currency)}</td>
    <td><span class="status status-saved">Saved</span></td>
    <td>${compact ? `<button class="row-view-link" data-action="view" data-id="${id}">Open <i class="fa-solid fa-arrow-up-right-from-square"></i></button>` : `<div class="row-actions"><button data-action="view" data-id="${id}" title="View"><i class="fa-regular fa-eye"></i></button><button data-action="edit" data-id="${id}" title="Edit"><i class="fa-regular fa-pen-to-square"></i></button><button data-action="delete" data-id="${id}" title="Delete"><i class="fa-regular fa-trash-can"></i></button></div>`}</td>
  </tr>`;
}
function renderClaims() {
  const count = state.claims.length;
  const amount = state.claims.reduce((sum, claim) => sum + total(claim), 0);
  const itemCount = state.claims.reduce((sum, claim) => sum + (claim.items || []).length, 0);
  const currency = state.claims[0]?.currency || "SAR";
  $("#statClaims").textContent = count;
  $("#statAmount").textContent = money(amount, currency);
  $("#bannerTotal").textContent = money(amount, currency);
  $("#statItems").textContent = itemCount;
  $("#claimCountNav").textContent = count;
  $("#claimsTableBody").innerHTML = state.claims.map(claim => claimRow(claim)).join("");
  $("#recentClaimsBody").innerHTML = state.claims.slice(0, 5).map(claim => claimRow(claim, true)).join("");
  $("#recentEmpty").classList.toggle("hidden", count > 0);
  $("#claimsEmpty").classList.toggle("hidden", count > 0);
  $(".table-wrapper", $("#dashboardPage")).classList.toggle("hidden", count === 0);
  const currencies = [...new Set(state.claims.map(claim => claim.currency).filter(Boolean))];
  $("#currencyFilter").innerHTML = `<option value="">All currencies</option>${currencies.map(value => `<option value="${safe(value)}">${safe(value)}</option>`).join("")}`;
}
function navigate(page) {
  const targetPage = page === "saved" ? "claims" : page;
  $$(".sidebar nav button[data-page]").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  $$(".page").forEach(section => section.classList.toggle("active", section.id === `${targetPage}Page`));
  const showClaimActions = page === "dashboard" || page === "claims" || page === "saved";
  $(".today-pill").classList.toggle("hidden", !showClaimActions);
  $("#newClaimTop").classList.toggle("hidden", !showClaimActions);
  const pages = {
    dashboard: ["Overview", "Good day", "Here’s what’s happening with your expenses."],
    claims: ["Claims", "All claims", "Your saved expense claims, all in one place."],
    saved: ["Saved claims", "Saved claims", "Claims you have saved or updated."],
    manage: ["Preferences", "Manage options", "Set up the options that make sense for your team."],
    profile: ["Account", "Your profile", "Optional details connected to your account."],
    settings: ["Account", "Account settings", "Manage your sign-in email and password."]
  };
  const [crumb, title, description] = pages[page] || pages.dashboard;
  $("#breadcrumbPage").textContent = crumb;
  $("#pageTitle").textContent = title;
  $("#pageDescription").textContent = description;
  $("#claimsPage .panel-header h2").textContent = page === "saved" ? "Saved claims" : "All claims";
}

function addDropdownDatalist(inputId, datalistId) {
  const input = $(inputId);
  input.setAttribute("list", datalistId);
  if (!$("#" + datalistId)) {
    const datalist = document.createElement("datalist");
    datalist.id = datalistId;
    $("#claimModal").append(datalist);
  }
}
function renderDropdowns() {
  const optionMeta = [
    ["costCenters", "Cost centers", "Projects, departments or sites", "#costCenterOptions", "Cost center"],
    ["categories", "Categories", "Group item expenses", "#categoryOptions", "Category"],
    ["currencies", "Currencies", "Currency codes", "#currencyOptions", "Currency"],
    ["invoiceNames", "Invoice names / numbers", "Common invoice references", "#invoiceNameOptions", "Invoice name / number"],
    ["itemDescriptions", "Purchase items", "Common item descriptions", "#itemDescriptionOptions", "Purchase item"],
    ["purposes", "Purchase purposes", "Common business purposes", "#purposeOptions", "Purpose"]
  ];
  const grid = $(".manage-grid");
  grid.innerHTML = optionMeta.map(([key, title, note]) => `<article class="manage-card"><div class="manage-card-title"><span class="manage-icon"><i class="fa-solid fa-list-check"></i></span><div><h3>${title}</h3><p>${note}</p></div></div><form data-options="${key}"><input type="text" placeholder="Add ${title.toLowerCase()}" required><button class="btn btn-primary" type="submit" aria-label="Add ${title}"><i class="fa-solid fa-plus"></i></button></form><div id="${key}List" class="option-list"></div></article>`).join("");
  for (const [key, , , datalistId, inputLabel] of optionMeta) {
    state.dropdowns[key] ||= [];
    const list = $(datalistId);
    if (list) list.innerHTML = state.dropdowns[key].map(value => `<option value="${safe(value)}">`).join("");
    const optionsList = $(`#${key}List`);
    optionsList.innerHTML = state.dropdowns[key].map((value, index) => `<div class="option-item"><span>${safe(value)}</span><button type="button" data-remove-option="${key}" data-index="${index}" aria-label="Remove ${safe(value)}"><i class="fa-solid fa-xmark"></i></button></div>`).join("") || `<p class="options-empty">No saved options yet.</p>`;
  }
  populateDatalists();
}
function populateDatalists() {
  const entries = [["costCenters", "#costCenterOptions"], ["categories", "#categoryOptions"], ["currencies", "#currencyOptions"], ["invoiceNames", "#invoiceNameOptions"], ["itemDescriptions", "#itemDescriptionOptions"], ["purposes", "#purposeOptions"]];
  for (const [key, selector] of entries) {
    const list = $(selector);
    if (list) list.innerHTML = (state.dropdowns[key] || []).map(value => `<option value="${safe(value)}">`).join("");
  }
}
async function saveDropdowns() {
  try {
    await api("/api/dropdowns", { method: "PUT", body: JSON.stringify(state.dropdowns) });
    renderDropdowns();
    toast("Dropdown options saved.");
  } catch (error) { toast(error.message, "error"); }
}

function closeModal(id) { $(`#${id}`).classList.remove("show"); }
function openClaim(claim = null) {
  state.editingId = claim?._id || null;
  state.items = structuredClone(claim?.items || []);
  editingItemIndex = null;
  $("#claimForm").reset();
  $("#claimForm").noValidate = true;
  $("#claimName").value = claim?.name || claim?.number || "";
  $("#claimDate").value = claim?.date || today();
  $("#claimCostCenter").value = claim?.costCenter || "";
  $("#claimCurrency").value = claim?.currency || "SAR";
  $("#claimTime").textContent = claim?.createdTime || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("#itemSupplier")?.closest(".form-group")?.remove();
  $("#itemSupplierNo")?.closest(".form-group")?.remove();
  addDropdownDatalist("#itemInvoice", "invoiceNameOptions");
  addDropdownDatalist("#itemDescription", "itemDescriptionOptions");
  addDropdownDatalist("#itemPurpose", "purposeOptions");
  populateDatalists();
  $$("#claimForm label b").forEach(marker => marker.remove());
  $("#claimModalTitle").textContent = claim ? "Edit expense claim" : "Create expense claim";
  $("#claimModal").classList.remove("is-fullscreen");
  claimFullscreenButton.innerHTML = `<i class="fa-solid fa-expand"></i>`;
  claimFullscreenButton.title = "Expand form";
  $("#saveClaimBtn").innerHTML = `<i class="fa-regular fa-floppy-disk"></i> ${claim ? "Update claim" : "Save claim"}`;
  setItemEntryMode(false);
  renderItems();
  $("#claimModal").classList.add("show");
}
function renderItems() {
  $("#itemsTableBody").innerHTML = state.items.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${safe(item.invoiceNumber || "—")}</strong><small>${safe(item.date || "No date")}</small></td><td><strong>${safe(item.description || "—")}</strong><small>${safe(item.purpose || "—")}</small></td><td class="amount-cell">${money(item.amount, $("#claimCurrency").value || "SAR")}</td><td>${safe(item.category || "—")}</td><td><div class="row-actions"><button type="button" data-item-action="view" data-index="${index}" title="View item"><i class="fa-regular fa-eye"></i></button><button type="button" data-item-action="edit" data-index="${index}" title="Edit item"><i class="fa-regular fa-pen-to-square"></i></button><button type="button" data-item-action="delete" data-index="${index}" title="Delete item"><i class="fa-regular fa-trash-can"></i></button></div></td></tr>`).join("");
  $("#itemsEmpty").classList.toggle("hidden", state.items.length > 0);
  $("#claimTotal").textContent = money(state.items.reduce((sum, item) => sum + Number(item.amount || 0), 0), $("#claimCurrency").value || "SAR");
  $("#claimItemCount").textContent = `${state.items.length} invoice ${state.items.length === 1 ? "item" : "items"}`;
}
function itemFormValues() {
  return { invoiceNumber: $("#itemInvoice").value.trim(), date: $("#itemDate").value, description: $("#itemDescription").value.trim(), purpose: $("#itemPurpose").value.trim(), amount: Number($("#itemAmount").value || 0), category: $("#itemCategory").value.trim() };
}
function clearItemFields() {
  for (const selector of ["#itemInvoice", "#itemDate", "#itemDescription", "#itemPurpose", "#itemAmount", "#itemCategory"]) $(selector).value = "";
}
function setItemEntryMode(editing) {
  const button = $("#addItemBtn");
  button.innerHTML = editing ? `<i class="fa-regular fa-floppy-disk"></i> Update item` : `<i class="fa-solid fa-plus"></i> Add item`;
  $("#cancelItemEditBtn")?.classList.toggle("hidden", !editing);
}
function openItemDetails(index) {
  const item = state.items[index];
  if (!item) return;
  let modal = $("#itemDetailModal");
  if (!modal) {
    modal = document.createElement("div"); modal.id = "itemDetailModal"; modal.className = "modal"; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><div><span class="section-kicker">INVOICE ITEM</span><h2>Item details</h2></div><button class="modal-close" type="button" data-close="itemDetailModal" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div id="itemDetailContent" class="view-meta"></div></div>`;
    document.body.append(modal);
  }
  const fields = [["Invoice name / number", item.invoiceNumber], ["Invoice date", item.date], ["Purchase item", item.description], ["Purpose", item.purpose], ["Amount", money(item.amount, $("#claimCurrency").value)], ["Category", item.category]];
  $("#itemDetailContent").innerHTML = fields.map(([label, value]) => `<div><small>${safe(label)}</small><strong>${safe(value || "—")}</strong></div>`).join("");
  modal.classList.add("show");
}
function ensureExcelExportModal() {
  let modal = $("#excelExportModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "excelExportModal"; modal.className = "modal"; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `<div class="modal-content"><div class="modal-header"><div><span class="section-kicker">EXCEL EXPORT</span><h2>Choose claim details</h2><p>Select a cost center and invoice to export.</p></div><button type="button" class="modal-close" data-close="excelExportModal" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><form id="excelExportForm" class="export-form"><div class="form-group"><label for="exportCostCenter">Cost center</label><select id="exportCostCenter"><option value="">All cost centers</option></select></div><div class="form-group"><label for="exportInvoice">Invoice name / number</label><select id="exportInvoice"><option value="">All invoices</option></select></div><div class="form-actions"><button type="button" class="btn btn-outline" data-close="excelExportModal">Cancel</button><span class="action-spacer"></span><button class="btn btn-primary" type="submit"><i class="fa-solid fa-download"></i> Export Excel</button></div></form></div>`;
  document.body.append(modal);
  $("#exportCostCenter", modal).addEventListener("change", () => populateExportInvoices());
  $("#excelExportForm", modal).addEventListener("submit", exportSelectedClaims);
  return modal;
}
function populateExportInvoices(selectedId = "") {
  const center = $("#exportCostCenter").value;
  const invoiceSelect = $("#exportInvoice");
  const matches = state.claims.filter(claim => !center || claim.costCenter === center);
  invoiceSelect.innerHTML = `<option value="">All invoices in this selection</option>${matches.map(claim => `<option value="${safe(claim._id)}">${safe(claim.number || claim.name || "Expense claim")}${claim.name && claim.number && claim.name !== claim.number ? ` — ${safe(claim.name)}` : ""}</option>`).join("")}`;
  invoiceSelect.value = selectedId;
}
function ensureExcelExportDialog() {
  let modal = $("#exportModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "exportModal"; modal.className = "modal"; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `<div class="modal-content"><div class="modal-header"><div><span class="section-kicker">EXCEL EXPORT</span><h2>Export expense claim</h2><p>Choose a cost center and claim to build both workbook sheets.</p></div><button class="modal-close" type="button" data-close="exportModal" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="export-form"><div class="form-group"><label for="exportCostCenter">Cost center</label><select id="exportCostCenter"><option value="">Select Cost Center</option></select></div><div class="form-group"><label for="exportClaim">Claim name / number</label><select id="exportClaim"><option value="">Select Claim</option></select></div><p id="exportInfo" class="export-info">Select a Cost Center, then choose a Claim.</p><div class="form-actions"><button type="button" class="btn btn-outline" data-close="exportModal">Cancel</button><span class="action-spacer"></span><button id="confirmExport" type="button" class="btn btn-primary"><i class="fa-solid fa-download"></i> Export Excel</button></div></div></div>`;
  document.body.append(modal);
  return modal;
}
async function openExcelExport(initialClaim = null) {
  ensureExcelExportDialog();
  try {
    await loadExportLibrary("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js", () => Boolean(window.ExcelJS?.Workbook));
    await loadExportLibrary("/excel-export-layout.js", () => typeof window.openExportDialog === "function");
    window.openExportDialog();
    if (initialClaim) {
      const center = $("#exportCostCenter");
      center.value = initialClaim.costCenter || "";
      center.dispatchEvent(new Event("change"));
      const selected = $("#exportClaim");
      selected.value = String(initialClaim._id);
      selected.dispatchEvent(new Event("change"));
    }
  } catch (error) { toast(error.message, "error"); }
}
async function exportSelectedClaims(event) {
  event.preventDefault();
  const center = $("#exportCostCenter").value;
  const invoiceId = $("#exportInvoice").value;
  const selected = state.claims.filter(claim => (!center || claim.costCenter === center) && (!invoiceId || String(claim._id) === invoiceId));
  if (!selected.length) return toast("No claims match those selections.", "error");
  try {
    await ensureExportLibraries("excel");
    if (selected.length === 1) exportExcel(selected[0]);
    else exportClaimsExcel(selected, center);
    closeModal("excelExportModal");
  } catch (error) { toast(error.message, "error"); }
}
function showClaim(claim) {
  state.viewing = claim;
  $("#viewTitle").textContent = claim.name || "Expense claim";
  $("#viewContent").innerHTML = `<div class="view-meta"><div><small>CLAIM NUMBER</small><strong>${safe(claim.number || "—")}</strong></div><div><small>CLAIM DATE</small><strong>${safe(claim.date || "—")}</strong></div><div><small>COST CENTER</small><strong>${safe(claim.costCenter || "—")}</strong></div><div><small>CREATED</small><strong>${safe(claim.createdTime || "—")}</strong></div></div><div class="table-wrapper view-table"><table><thead><tr><th>SN</th><th>INVOICE NAME / NUMBER</th><th>DATE</th><th>PURCHASE ITEM</th><th>PURPOSE</th><th>AMOUNT</th><th>CATEGORY</th></tr></thead><tbody>${(claim.items || []).map((item, index) => `<tr><td>S${index + 1}</td><td>${safe(item.invoiceNumber || "—")}</td><td>${safe(item.date || "—")}</td><td>${safe(item.description || "—")}</td><td>${safe(item.purpose || "—")}</td><td>${money(item.amount, claim.currency)}</td><td>${safe(item.category || "—")}</td></tr>`).join("")}<tr class="grand-total"><td colspan="4"></td><td><strong>GRAND TOTAL</strong></td><td><strong>${money(total(claim), claim.currency)}</strong></td><td></td></tr></tbody></table></div>`;
  $("#viewModal").classList.add("show");
}

$("#closeClaimModal").addEventListener("click", () => closeModal("claimModal"));
$("#cancelClaimBtn").addEventListener("click", () => closeModal("claimModal"));
$("#clearClaimBtn").addEventListener("click", () => {
  state.items = [];
  editingItemIndex = null;
  $("#claimForm").reset();
  $("#claimDate").value = today();
  $("#claimCurrency").value = "SAR";
  $("#claimTime").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  setItemEntryMode(false);
  renderItems();
});
$("#addItemBtn").addEventListener("click", () => {
  const item = itemFormValues();
  if (editingItemIndex === null) state.items.push(item);
  else state.items[editingItemIndex] = item;
  editingItemIndex = null;
  clearItemFields(); setItemEntryMode(false);
  renderItems();
});
const cancelItemEdit = document.createElement("button");
cancelItemEdit.id = "cancelItemEditBtn"; cancelItemEdit.type = "button"; cancelItemEdit.className = "btn btn-outline hidden"; cancelItemEdit.textContent = "Cancel edit";
$("#addItemBtn").parentElement.append(cancelItemEdit);
cancelItemEdit.addEventListener("click", () => { editingItemIndex = null; clearItemFields(); setItemEntryMode(false); });
$("#claimCurrency").addEventListener("input", renderItems);
$("#itemsTableBody").addEventListener("click", event => {
  const button = event.target.closest("[data-item-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  const action = button.dataset.itemAction;
  const item = state.items[index];
  if (action === "view") return openItemDetails(index);
  if (action === "edit") {
    if (!item) return;
    editingItemIndex = index;
    $("#itemInvoice").value = item.invoiceNumber || ""; $("#itemDate").value = item.date || "";
    $("#itemDescription").value = item.description || ""; $("#itemPurpose").value = item.purpose || "";
    $("#itemAmount").value = item.amount || ""; $("#itemCategory").value = item.category || "";
    setItemEntryMode(true); $("#itemInvoice").focus();
    return;
  }
  if (action === "delete") {
    state.items.splice(index, 1);
    if (editingItemIndex === index) { editingItemIndex = null; clearItemFields(); setItemEntryMode(false); }
    else if (editingItemIndex !== null && editingItemIndex > index) editingItemIndex -= 1;
  }
  renderItems();
});
$("#claimForm").addEventListener("submit", async event => {
  event.preventDefault();
  const reference = $("#claimName").value.trim();
  const generatedNumber = `EC-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
  const payload = {
    name: reference || "Expense claim",
    number: reference || state.claims.find(claim => claim._id === state.editingId)?.number || generatedNumber,
    date: $("#claimDate").value || today(),
    costCenter: $("#claimCostCenter").value.trim(),
    currency: $("#claimCurrency").value.trim() || "SAR",
    createdTime: $("#claimTime").textContent,
    items: state.items
  };
  const button = $("#saveClaimBtn");
  button.disabled = true;
  try {
    const updating = Boolean(state.editingId);
    await api(updating ? `/api/claims/${state.editingId}` : "/api/claims", { method: updating ? "PUT" : "POST", body: JSON.stringify(payload) });
    closeModal("claimModal");
    await refreshAll();
    toast(updating ? "Claim updated." : "Claim saved.");
  } catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; }
});

$(".sidebar nav").addEventListener("click", event => {
  const button = event.target.closest("[data-page]");
  if (button) navigate(button.dataset.page);
});
document.addEventListener("click", async event => {
  const createButton = event.target.closest("#newClaimTop, #newClaimBanner, #emptyCreate, #newClaimList");
  if (createButton) { openClaim(); return; }
  const goto = event.target.closest("[data-goto]");
  if (goto) { navigate(goto.dataset.goto); return; }
  const close = event.target.closest("[data-close]");
  if (close) { closeModal(close.dataset.close); return; }
  const action = event.target.closest("[data-action]");
  if (action) {
    const claim = state.claims.find(record => String(record._id) === action.dataset.id);
    if (!claim) return;
    if (action.dataset.action === "view") showClaim(claim);
    if (action.dataset.action === "edit") openClaim(claim);
    if (action.dataset.action === "delete" && confirm(`Delete “${claim.name || "Expense claim"}”? This cannot be undone.`)) {
      try { await api(`/api/claims/${claim._id}`, { method: "DELETE" }); await refreshAll(); toast("Claim deleted."); }
      catch (error) { toast(error.message, "error"); }
    }
  }
  const remove = event.target.closest("[data-remove-option]");
  if (remove) {
    const key = remove.dataset.removeOption;
    state.dropdowns[key].splice(Number(remove.dataset.index), 1);
    await saveDropdowns();
  }
  const exportChoice = event.target.closest("[data-export]");
  if (exportChoice && state.viewing) {
    if (exportChoice.dataset.export === "excel") { openExcelExport(state.viewing); $("#exportOptions").classList.add("hidden"); return; }
    try {
      await ensureExportLibraries(exportChoice.dataset.export);
      if (exportChoice.dataset.export === "excel") exportExcel(state.viewing);
      else if (exportChoice.dataset.export === "pdf") exportPdf(state.viewing);
      else await exportWord(state.viewing);
    } catch (error) { toast(`Export failed: ${error.message}`, "error"); }
    $("#exportOptions").classList.add("hidden");
  }
});
$("#viewEditBtn").addEventListener("click", () => {
  const claim = state.viewing;
  closeModal("viewModal");
  if (claim) openClaim(claim);
});
$("#exportClaimBtn").addEventListener("click", () => $("#exportOptions").classList.toggle("hidden"));
$("#claimSearch").addEventListener("input", filterClaims);
$("#currencyFilter").addEventListener("change", filterClaims);
function filterClaims() {
  const text = $("#claimSearch").value.trim().toLowerCase();
  const currency = $("#currencyFilter").value;
  $$("#claimsTableBody tr").forEach(row => {
    const claim = state.claims.find(record => String(record._id) === row.dataset.claimId);
    row.classList.toggle("hidden", !claim || !(String(claim.name).toLowerCase().includes(text) || String(claim.number).toLowerCase().includes(text) || String(claim.costCenter).toLowerCase().includes(text)) || Boolean(currency && claim.currency !== currency));
  });
}
$(".manage-grid").addEventListener("submit", async event => {
  const form = event.target.closest("form[data-options]");
  if (!form) return;
  event.preventDefault();
  const key = form.dataset.options;
  const input = $("input", form);
  const value = input.value.trim();
  if (!value || !state.dropdowns[key]) return;
  if (state.dropdowns[key].some(option => option.toLowerCase() === value.toLowerCase())) return toast("That option is already on the list.", "error");
  state.dropdowns[key].push(value);
  await saveDropdowns();
});
[$("#claimModal"), $("#viewModal")].forEach(modal => modal.addEventListener("click", event => { if (event.target === modal) closeModal(modal.id); }));
document.addEventListener("keydown", event => { if (event.key === "Escape") $$(".modal.show").forEach(modal => closeModal(modal.id)); });

const supplierColumn = $("#itemsTableBody").closest("table").querySelectorAll("thead th")[2];
if (supplierColumn) supplierColumn.remove();
$("#claimForm").noValidate = true;

const exportLibraryLoads = new Map();
function loadExportLibrary(src, isReady) {
  if (isReady()) return Promise.resolve();
  if (exportLibraryLoads.has(src)) return exportLibraryLoads.get(src);
  const loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => isReady() ? resolve() : reject(new Error("The export library did not initialize."));
    script.onerror = () => {
      exportLibraryLoads.delete(src);
      reject(new Error("Could not load the export library. Check your internet connection and try again."));
    };
    document.head.append(script);
  });
  exportLibraryLoads.set(src, loading);
  return loading;
}
async function ensureExportLibraries(format) {
  if (format === "excel") await loadExportLibrary("https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js", () => Boolean(window.XLSX));
  if (format === "pdf") {
    await loadExportLibrary("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", () => Boolean(window.jspdf?.jsPDF));
    await loadExportLibrary("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js", () => Boolean(window.jspdf?.jsPDF?.API?.autoTable));
  }
  if (format === "word") await loadExportLibrary("https://cdnjs.cloudflare.com/ajax/libs/docx/8.5.0/docx.umd.js", () => Boolean(window.docx?.Document));
}

function exportRows(claim) {
  return (claim.items || []).map((item, index) => [
    `S${index + 1}`, item.invoiceNumber || "", item.date || "", item.description || "", item.purpose || "", Number(item.amount || 0), item.category || ""
  ]);
}
const exportHeaders = ["SN", "Invoice name / number", "Date", "Purchase item", "Purpose", "Amount", "Category"];
function exportExcel(claim) {
  const rows = [
    ["EXPENSE CLAIM — PROJECT SUMMARY"],
    [`Claim: ${claim.name || "Expense claim"} | Cost center: ${claim.costCenter || "—"} | Claim no: ${claim.number || "—"}`],
    [`Date: ${claim.date || "—"}`], [], exportHeaders,
    ...exportRows(claim), ["", "", "", "", "GRAND TOTAL", total(claim), ""]
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = [0, 1, 2].map(row => ({ s: { r: row, c: 0 }, e: { r: row, c: 6 } }));
  sheet["!cols"] = [8, 22, 15, 30, 30, 16, 19].map(wch => ({ wch }));
  for (let row = 0; row < rows.length; row++) for (let col = 0; col < 7; col++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell) continue;
    const title = row === 0, header = row === 4;
    cell.s = { font: { name: "Aptos", sz: title ? 16 : 10, bold: title || header }, alignment: { vertical: "center", wrapText: true, horizontal: title || header ? "center" : "left" }, border: { top: { style: "thin", color: { rgb: "222222" } }, bottom: { style: "thin", color: { rgb: "222222" } }, left: { style: "thin", color: { rgb: "222222" } }, right: { style: "thin", color: { rgb: "222222" } } } };
    if (title) cell.s.fill = { fgColor: { rgb: "102C3A" } };
    if (header) cell.s.fill = { fgColor: { rgb: "D9E7E8" } };
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Project Summary");
  XLSX.writeFile(workbook, `${claim.number || "expense-claim"}.xlsx`);
}
function exportClaimsExcel(claims, costCenter) {
  const headers = ["Claim name / number", "Cost center", "Claim date", "Currency", ...exportHeaders];
  const rows = [["EXPENSE CLAIM — PROJECT SUMMARY"], [`Cost center: ${costCenter || "All cost centers"}`], [`Exported: ${new Date().toLocaleDateString()}`], [], headers];
  for (const claim of claims) {
    const lines = exportRows(claim);
    if (lines.length) for (const line of lines) rows.push([claim.name || claim.number || "Expense claim", claim.costCenter || "", claim.date || "", claim.currency || "SAR", ...line]);
    else rows.push([claim.name || claim.number || "Expense claim", claim.costCenter || "", claim.date || "", claim.currency || "SAR", "", "", "", "", "", 0, ""]);
    rows.push(["", "", "", "", "", "", "", "", "GRAND TOTAL", total(claim), ""]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = [0, 1, 2].map(row => ({ s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } }));
  sheet["!cols"] = [24, 20, 15, 12, 8, 23, 15, 30, 28, 16, 18].map(wch => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Project Summary");
  XLSX.writeFile(workbook, `${(costCenter || "Expense-Claims").replace(/[^a-z0-9-_]/gi, "_")}-claims.xlsx`);
}
function exportPdf(claim) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  pdf.setFillColor(16, 44, 58); pdf.rect(0, 0, 842, 76, "F"); pdf.setTextColor(255, 255, 255); pdf.setFontSize(18); pdf.text("EXPENSE CLAIM", 40, 38); pdf.setFontSize(10); pdf.text("PROJECT SUMMARY", 40, 57);
  pdf.setTextColor(40, 55, 65); pdf.text(`Claim: ${claim.name || "Expense claim"}    Cost center: ${claim.costCenter || "—"}    Claim no: ${claim.number || "—"}`, 40, 103); pdf.text(`Date: ${claim.date || "—"}`, 40, 120);
  pdf.autoTable({ startY: 140, head: [exportHeaders], body: [...exportRows(claim), ["", "", "", "", "GRAND TOTAL", money(total(claim), claim.currency), ""]], theme: "grid", styles: { fontSize: 8, lineColor: [20, 20, 20], lineWidth: .35, cellPadding: 6 }, headStyles: { fillColor: [217, 231, 232], textColor: [16, 44, 58], fontStyle: "bold" } });
  pdf.save(`${claim.number || "expense-claim"}.pdf`);
}
async function exportWord(claim) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType } = window.docx;
  const border = { style: BorderStyle.SINGLE, size: 4, color: "222222" };
  const cell = (text, header = false) => new TableCell({ children: [new Paragraph({ text: String(text ?? ""), bold: header })], shading: header ? { type: ShadingType.CLEAR, fill: "D9E7E8" } : undefined, borders: { top: border, bottom: border, left: border, right: border } });
  const dataRows = exportRows(claim).map(row => new TableRow({ children: row.map(value => cell(value)) }));
  dataRows.push(new TableRow({ children: [cell(""), cell(""), cell(""), cell(""), cell("GRAND TOTAL", true), cell(money(total(claim), claim.currency), true), cell("")] }));
  const doc = new Document({ sections: [{ properties: { page: { size: { orientation: "landscape" }, margin: { top: 800, right: 600, bottom: 800, left: 600 } } }, children: [new Paragraph({ text: "EXPENSE CLAIM", heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }), new Paragraph({ text: "PROJECT SUMMARY", alignment: AlignmentType.CENTER }), new Paragraph({ text: `Claim: ${claim.name || "Expense claim"}     Cost center: ${claim.costCenter || "—"}     Claim no: ${claim.number || "—"}` }), new Paragraph({ text: `Date: ${claim.date || "—"}` }), new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: exportHeaders.map(value => cell(value, true)) }), ...dataRows] })] }] });
  const blob = await Packer.toBlob(doc);
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${claim.number || "expense-claim"}.docx`; link.click(); URL.revokeObjectURL(link.href);
}
$("#exportAllBtn").addEventListener("click", () => openExcelExport());

api("/api/auth/me").then(data => showApp(data.user)).catch(() => {
  $("#authPage").classList.remove("hidden");
  $("#appPage").classList.add("hidden");
});
