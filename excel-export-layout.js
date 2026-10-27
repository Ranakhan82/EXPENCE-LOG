/* =========================================================
   EXCEL EXPORT
========================================================= */

$("#exportExcel")?.addEventListener("click", openExportDialog);

function openExportDialog() {
  if (!claims.length) {
    showToast("There are no saved claims to export.", "error");
    return;
  }

  const centerSelect = $("#exportCostCenter");
  const claimSelect = $("#exportClaim");

  if (!centerSelect || !claimSelect) {
    showToast("Excel export controls were not found.", "error");
    return;
  }

  const centers = [
    ...new Set(claims.map((claim) => claim.costCenter).filter(Boolean))
  ];

  centerSelect.innerHTML =
    '<option value="">Select Cost Center</option>' +
    centers.map((center) =>
      `<option value="${escapeHTML(center)}">${escapeHTML(center)}</option>`
    ).join("");

  claimSelect.innerHTML = '<option value="">Select Claim</option>';

  if ($("#exportInfo")) {
    $("#exportInfo").textContent =
      "Select a Cost Center, then choose a Claim. All items inside that claim will be exported.";
  }

  openModal("exportModal");
}

$("#exportCostCenter")?.addEventListener("change", () => {
  const center = $("#exportCostCenter").value;
  const claimSelect = $("#exportClaim");
  if (!claimSelect) return;

  const matchingClaims = claims.filter(
    (claim) => claim.costCenter === center
  );

  claimSelect.innerHTML =
    '<option value="">Select Claim</option>' +
    matchingClaims.map((claim) => `
      <option value="${escapeHTML(claim.id)}">
        ${escapeHTML(claim.claimName || "Untitled Claim")} — ${escapeHTML(formatDate(claim.claimDate))}
      </option>
    `).join("");

  if ($("#exportInfo")) {
    $("#exportInfo").textContent = center
      ? `${matchingClaims.length} claim(s) found for Cost Center ${center}. Select one claim to export all its items.`
      : "Select a Cost Center, then choose a Claim.";
  }
});

$("#exportClaim")?.addEventListener("change", () => {
  const claim = claims.find(
    (entry) => entry.id === $("#exportClaim")?.value
  );

  if ($("#exportInfo")) {
    $("#exportInfo").textContent = claim
      ? `Selected: ${claim.claimName} | Cost Center: ${claim.costCenter || "—"} | Items: ${(claim.items || []).length} | Total: ${money(claimTotal(claim), claim.currency)}`
      : "Select a Cost Center and Claim to export all items.";
  }
});

$("#confirmExport")?.addEventListener("click", async () => {
  const center = $("#exportCostCenter")?.value;
  const claimId = $("#exportClaim")?.value;

  if (!center || !claimId) {
    showToast("Please select both Cost Center and Claim.", "error");
    return;
  }

  const claim = claims.find(
    (entry) => entry.id === claimId && entry.costCenter === center
  );

  if (!claim) {
    showToast("The selected claim could not be found.", "error");
    return;
  }

  if (!window.ExcelJS) {
    showToast(
      "Excel library did not load. Check your internet connection and reopen the page.",
      "error"
    );
    return;
  }

  try {
    await exportClaimToExcel(claim);
    closeModal("exportModal");
    showToast("Excel file created successfully.");
  } catch (error) {
    console.error("Excel export failed:", error);
    showToast("Excel export failed. Please try again.", "error");
  }
});

async function exportClaimToExcel(claim) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "EXPENSE CLAIM";
  workbook.created = new Date();
  workbook.modified = new Date();

  const items = Array.isArray(claim.items) ? claim.items : [];

  const totalAmount = items.reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0
  );

  const black = "FF000000";
  const white = "FFFFFFFF";
  const navy = "FF14213D";
  const blue = "FF3563E9";
  const lightBlue = "FFDCE7FF";
  const grey = "FFE7E7E7";
  const red = "FFFF0000";

  const moneyFormat = '#,##0.00;[Red]-#,##0.00';

  const thinBorder = {
    top: { style: "thin", color: { argb: black } },
    bottom: { style: "thin", color: { argb: black } },
    left: { style: "thin", color: { argb: black } },
    right: { style: "thin", color: { argb: black } }
  };

  const mediumBorder = {
    top: { style: "medium", color: { argb: black } },
    bottom: { style: "medium", color: { argb: black } },
    left: { style: "medium", color: { argb: black } },
    right: { style: "medium", color: { argb: black } }
  };

  /* ======================================================
     SHEET 1: EXPENSE CLAIM
  ====================================================== */

  const sheet = workbook.addWorksheet("Expense Claim", {
    views: [{ state: "frozen", ySplit: 3 }]
  });

  sheet.columns = [
    { width: 7 },
    { width: 15 },
    { width: 13 },
    { width: 15 },
    { width: 17 },
    { width: 24 },
    { width: 25 },
    { width: 17 },
    { width: 16 }
  ];

  sheet.mergeCells("A1:I1");

  const titleCell = sheet.getCell("A1");
  titleCell.value =
    `SUMMARY OF GENERAL EXPENSE CLAIM IN KSP- PROJECT COST CENTER ${claim.costCenter || ""}`;
  titleCell.font = {
    bold: true,
    size: 14,
    color: { argb: white }
  };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: navy }
  };
  titleCell.alignment = {
    horizontal: "center",
    vertical: "middle"
  };
  sheet.getRow(1).height = 30;

  sheet.mergeCells("A2:I2");

  const dateCell = sheet.getCell("A2");
  dateCell.value = `Date: ${formatDate(localDateInputValue())}`;
  dateCell.font = { bold: true, size: 10 };
  dateCell.alignment = {
    horizontal: "right",
    vertical: "middle"
  };
  sheet.getRow(2).height = 20;

  const headers = [
    "S/N",
    "INVOICE #",
    "DATE #",
    "SUPPLIER NAME",
    "ITEM # IN THE INVOICE",
    "ITEM DESCRIPTION",
    "PURPOSE OF ITEMS PURCHASED",
    "AMOUNT OF THE ITEM",
    "CATEGORY"
  ];

  const headerRow = sheet.getRow(3);
  headerRow.values = headers;
  headerRow.height = 38;

  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = {
      bold: true,
      size: 9,
      color: { argb: white }
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: blue }
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true
    };
    cell.border = { ...thinBorder };
  });

  const supplierSerials = new Map();
  let nextSupplierNumber = 1;

  items.forEach((item, index) => {
    const invoiceNumber = String(item.invoiceNumber || "").trim();
    let supplierName;

    if (invoiceNumber) {
      const key = invoiceNumber.toLowerCase();

      if (!supplierSerials.has(key)) {
        supplierSerials.set(key, `S${nextSupplierNumber++}`);
      }

      supplierName = supplierSerials.get(key);
    } else {
      supplierName = `S${nextSupplierNumber++}`;
    }

    const row = sheet.addRow([
      index + 1,
      invoiceNumber,
      item.invoiceDate ? formatDate(item.invoiceDate) : "",
      supplierName,
      1,
      item.description || "",
      item.purpose || "",
      Number(item.amount) || 0,
      item.category || ""
    ]);

    row.height = 20;

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: false
      };
      cell.border = { ...thinBorder };
    });

    row.getCell(8).numFmt = moneyFormat;
  });

  const totalRowNumber = sheet.rowCount + 1;

  sheet.mergeCells(`A${totalRowNumber}:F${totalRowNumber}`);
  sheet.mergeCells(`H${totalRowNumber}:I${totalRowNumber}`);

  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.getCell(7).value = "GRAND TOTAL";
  totalRow.getCell(8).value = totalAmount;
  totalRow.height = 24;

  for (let c = 1; c <= 9; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true };
    cell.border = { ...thinBorder };
    cell.alignment = {
      horizontal: c === 7 ? "right" : "center",
      vertical: "middle"
    };
  }

  totalRow.getCell(8).numFmt = moneyFormat;

  for (let r = 1; r <= sheet.rowCount; r++) {
    for (let c = 1; c <= 9; c++) {
      const cell = sheet.getRow(r).getCell(c);

      cell.border = {
        ...cell.border,
        ...(r === 1 ? { top: mediumBorder.top } : {}),
        ...(r === sheet.rowCount
          ? { bottom: mediumBorder.bottom }
          : {}),
        ...(c === 1 ? { left: mediumBorder.left } : {}),
        ...(c === 9 ? { right: mediumBorder.right } : {})
      };
    }
  }

  sheet.autoFilter = {
    from: "A3",
    to: "I3"
  };

  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2
    },
    printTitlesRow: "1:3"
  };

  /* ======================================================
     COVER PAGE CATEGORY DEFINITIONS
     LEFT SECTION: A, B, C
     RIGHT SECTION: D, E, F
     TOTAL COLUMNS: A:F ONLY
  ====================================================== */

  const leftSections = [
    {
      code: "A",
      title: "A) Business Trip Expenses",
      rows: [
        ["450031", "1. Accommodation Expenses"],
        ["450031", "2. Food & Beverage"],
        ["450031", "3. Transportation Expenses"],
        ["450031", "4. Visa Expenses"],
        ["450031", "5. Trip Air Fare"],
        ["450031", "6. Car Fuel"],
        ["450031", "7. Parking & Causeway"]
      ]
    },
    {
      code: "B",
      title: "B) Employee Personal Expenses",
      rows: [
        ["420045", "1. Accommodation Expenses/Maintenance"],
        ["420046", "2. Personal Catering Expenses"],
        ["450029", "3. Individual Communication Expenses"],
        ["450065", "4. Car Rental/Repair/Fuel or Transportation"],
        ["420015", "5. Medical Expenses"],
        ["420037", "6. Uniform/Safety Gear/PPE"],
        ["420027", "7. Employee's Government Fees"],
        ["420061", "8. Fine (Traffic Or Others)"],
        ["420047", "9. Training"],
        ["420047", "10. Cost of Tickets / Tours (TRD)"]
      ]
    },
    {
      code: "C",
      title: "C) Equipment & Vehicles",
      rows: [
        ["450066", "1. Bus: Rental / Repair / Fuel"],
        ["450046", "2. Transportation of Materials or Equipment"],
        ["450061", "3. Direct Equipment: Rental / Repair / Fuel"],
        ["450051", "4. Indirect Equipment: Rental / Repair / Fuel"]
      ]
    }
  ];

  const rightSections = [
    {
      code: "D",
      title: "D) Running Costs",
      rows: [
        ["450018", "1. Stationery & Photocopying Expenses"],
        ["450018", "2. Offices Equipment or Furniture"],
        ["420046", "3. Offices Refreshment & Pantry Expenses"],
        ["450029", "4. Offices Internet"],
        ["450021", "5. Site Disposals & Septic Services"],
        ["410017", "6. Cleaning & Maintenance of Site Offices"],
        ["450028", "7. Washing Water"],
        ["420015", "8. Medical & Clinical Materials"]
      ]
    },
    {
      code: "E",
      title: "E) Construction Costs",
      rows: [
        ["420015", "1. Laydown Construction Materials / Works"],
        ["410027", "2. Safety Materials on Site (Non-Personal)"],
        ["410027", "3. Construction Tools"],
        ["410002", "4. Site Direct Civil Materials/Works"],
        ["410002", "5. Site Direct Low Current Materials/Works"],
        ["410002", "6. Site Direct Electrical Materials/Works"],
        ["410002", "7. Site Direct Mechanical Materials/Works"],
        ["450028", "8. Water For Construction"],
        ["420057", "9. Manpower / Rental Wages"],
        ["420046", "10. Ice, Drinking Water, or Food for Labors"]
      ]
    },
    {
      code: "F",
      title: "F) Other Services",
      rows: [
        ["420046", "1. Freight & Clearance Charges"],
        ["410027", "2. Materials Testing"],
        ["410002", "3. Other Incidental Expenses"]
      ]
    }
  ];

  const cover = workbook.addWorksheet("Cover Page");

  // Six columns only: A,B,C | D,E,F
  // No separate blank column.
  cover.columns = [
    { width: 11 }, // A: GL Code
    { width: 25 }, // B: Description
    { width: 12 }, // C: Amount
    { width: 11 }, // D: GL Code
    { width: 25 }, // E: Description
    { width: 12 }  // F: Amount
  ];

  function styleCell(cell, options = {}) {
    cell.border = { ...thinBorder };

    cell.alignment = {
      vertical: "middle",
      horizontal: options.align || "left",
      wrapText: options.wrapText ?? false
    };

    if (options.bold) {
      cell.font = { ...(cell.font || {}), bold: true };
    }

    if (options.fill) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: options.fill }
      };
    }
  }

  function setCoverCell(address, value, options = {}) {
    const cell = cover.getCell(address);
    cell.value = value;
    styleCell(cell, options);
    return cell;
  }

  function mergeLabelValue(labelRange, valueRange, label, value = "") {
    if (labelRange.includes(":")) {
      cover.mergeCells(labelRange);
    }

    if (valueRange.includes(":")) {
      cover.mergeCells(valueRange);
    }

    const labelCell = cover.getCell(labelRange.split(":")[0]);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 9 };
    labelCell.alignment = {
      vertical: "middle",
      horizontal: "left",
      wrapText: true
    };

    const valueCell = cover.getCell(valueRange.split(":")[0]);
    valueCell.value = value;
    valueCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: lightBlue }
    };
    valueCell.alignment = {
      vertical: "middle",
      horizontal: "left",
      wrapText: true
    };

    for (const range of [labelRange, valueRange]) {
      const [start, end] = range.split(":");
      const startCell = cover.getCell(start);
      const endCell = cover.getCell(end || start);

      for (let r = startCell.row; r <= endCell.row; r++) {
        for (let c = startCell.col; c <= endCell.col; c++) {
          styleCell(cover.getRow(r).getCell(c));
        }
      }
    }
  }

  /* ======================================================
     COVER TITLE / COMPANY HEADER
  ====================================================== */

  cover.mergeCells("A1:C2");
  cover.mergeCells("D1:F2");

  const logoCell = cover.getCell("A1");
  logoCell.value = "NESMA\nUNITED INDUSTRIES";
  logoCell.font = {
    bold: true,
    size: 18,
    color: { argb: "FF222222" }
  };
  logoCell.alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true
  };

  const coverTitle = cover.getCell("D1");
  coverTitle.value = "GENERAL EXPENSE CLAIM";
  coverTitle.font = {
    bold: true,
    size: 14,
    name: "Times New Roman"
  };
  coverTitle.alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true
  };

  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= 6; c++) {
      styleCell(cover.getRow(r).getCell(c));
    }
  }

  cover.getRow(1).height = 30;
  cover.getRow(2).height = 26;

  /* ======================================================
     EMPLOYEE / CLAIM INFORMATION
  ====================================================== */

  mergeLabelValue("A3:A3", "B3:C3", "NAME:", claim.claimName || "");
  mergeLabelValue("D3:D3", "E3:F3", "DATE:", formatDate(claim.claimDate));

  mergeLabelValue("A4:A4", "B4:C4", "ID NO:");
  mergeLabelValue("D4:D4", "E4:F4", "POSITION:");

  mergeLabelValue("A5:A5", "B5:C5", "DIVISION:", "137: LANDSCAPING");
  mergeLabelValue("D5:E5", "F5:F5", "PROJECT / DEPT. COST CENTER:", claim.costCenter || "");

  for (let r = 3; r <= 5; r++) {
    cover.getRow(r).height = 20;
  }

  /* ======================================================
     CATEGORY AMOUNT MATCHING
  ====================================================== */

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9.]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  const mappedRows = [];
  const unmatched = [];

  [...leftSections, ...rightSections].forEach((section) => {
    section.rows.forEach(([glCode, description], index) => {
      const label = description.replace(/^\d+\.\s*/, "");

      mappedRows.push({
        sectionCode: section.code,
        rowCode: `${section.code}.${index + 1}`,
        glCode,
        description,
        label,
        amount: 0,
        searchTerms: [
          glCode,
          description,
          label,
          `${section.code}.${index + 1}`,
          `${section.code}${index + 1}`
        ].map(normalizeText)
      });
    });
  });

  items.forEach((item) => {
    const amount = Number(item.amount) || 0;
    const category = String(item.category || "").trim();

    if (!category) {
      if (amount !== 0) {
        unmatched.push({
          category: "(No category)",
          description: item.description || "",
          amount
        });
      }
      return;
    }

    const normalized = normalizeText(category);

    let matches = mappedRows.filter((row) =>
      row.searchTerms.includes(normalized)
    );

    if (!matches.length) {
      matches = mappedRows.filter(
        (row) => normalizeText(row.label) === normalized
      );
    }

    if (matches.length === 1) {
      matches[0].amount += amount;
    } else {
      unmatched.push({
        category,
        description: item.description || "",
        amount
      });
    }
  });

  /* ======================================================
     DRAW CATEGORY SECTIONS
     LEFT: A,B,C IN A:C
     RIGHT: D,E,F IN D:F
  ====================================================== */

  let leftRow = 6;
  let rightRow = 6;

  function drawSection(section, startRow, startCol) {
    const codeCol = startCol;
    const descriptionCol = startCol + 1;
    const amountCol = startCol + 2;


// CATEGORY HEADER — NO MERGE
const codeHeader = cover.getRow(startRow).getCell(codeCol);
const heading = cover.getRow(startRow).getCell(descriptionCol);

// LEFT CELL: BLANK
codeHeader.value = null;
codeHeader.fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: grey }
};
codeHeader.alignment = {
  horizontal: "center",
  vertical: "middle",
  wrapText: false
};
styleCell(codeHeader, {
  fill: grey,
  align: "center"
});

// RIGHT CELL: CATEGORY TITLE
heading.value = section.title;
heading.font = {
  bold: true,
  italic: true,
  size: 10
};
heading.fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: grey }
};
heading.alignment = {
  horizontal: "center",
  vertical: "middle",
  wrapText: false
};
styleCell(heading, {
  bold: true,
  align: "center",
  fill: grey
});

// AMOUNT HEADER — SAR ONLY FOR A AND D
const amountHeader = cover.getRow(startRow).getCell(amountCol);
amountHeader.value =
  section.code === "A" || section.code === "D"
    ? "Amount\n(SAR)"
    : null;

amountHeader.font = { bold: true, size: 9 };
amountHeader.fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: grey }
};
amountHeader.alignment = {
  horizontal: "center",
  vertical: "middle",
  wrapText: false
};
styleCell(amountHeader, {
  bold: true,
  align: "center",
  wrapText: false,
  fill: grey
});

cover.getRow(startRow).height = 28;

    let rowNumber = startRow + 1;
    let sectionTotal = 0;

    section.rows.forEach(([glCode, description], index) => {
      const code = `${section.code}.${index + 1}`;

      const rowMapping = mappedRows.find(
        (row) => row.rowCode === code
      );

      const amount = rowMapping ? rowMapping.amount : 0;
      sectionTotal += amount;

      const codeCell = cover.getRow(rowNumber).getCell(codeCol);
      codeCell.value = glCode;
      styleCell(codeCell, { align: "center" });

      const descriptionCell = cover.getRow(rowNumber).getCell(descriptionCol);
      descriptionCell.value = description;
      styleCell(descriptionCell, { wrapText: true });

      const amountCell = cover.getRow(rowNumber).getCell(amountCol);
      amountCell.value = amount === 0 ? null : amount;
      amountCell.numFmt = moneyFormat;
      styleCell(amountCell, { align: "center" });

      cover.getRow(rowNumber).height = 20;
      rowNumber++;
    });

    return {
      nextRow: rowNumber,
      total: sectionTotal
    };
  }

  const leftResults = [];
  const rightResults = [];

  let leftGroupTotal = 0;
  let rightGroupTotal = 0;

  leftSections.forEach((section) => {
    const result = drawSection(section, leftRow, 1);
    leftResults.push(result);
    leftGroupTotal += result.total;
    leftRow = result.nextRow;
  });

  rightSections.forEach((section) => {
    const result = drawSection(section, rightRow, 4);
    rightResults.push(result);
    rightGroupTotal += result.total;
    rightRow = result.nextRow;
  });

  /* ======================================================
     SUBTOTAL: A + B + C
  ====================================================== */

  const leftSubtotalRow = leftRow;

  cover.mergeCells(`A${leftSubtotalRow}:B${leftSubtotalRow}`);

  const leftSubtotalLabel = cover.getCell(`A${leftSubtotalRow}`);
  leftSubtotalLabel.value = "SUB - TOTAL";
  leftSubtotalLabel.font = { bold: true, size: 9 };
  leftSubtotalLabel.alignment = {
    horizontal: "right",
    vertical: "middle"
  };
  styleCell(leftSubtotalLabel, {
    bold: true,
    align: "right"
  });

  const leftSubtotalAmount = cover.getCell(`C${leftSubtotalRow}`);
  leftSubtotalAmount.value =
    leftGroupTotal === 0 ? null : leftGroupTotal;
  leftSubtotalAmount.numFmt = moneyFormat;
  leftSubtotalAmount.font = { bold: true, size: 9 };
  leftSubtotalAmount.alignment = {
    horizontal: "center",
    vertical: "middle"
  };
  styleCell(leftSubtotalAmount, {
    bold: true,
    align: "center"
  });

  cover.getRow(leftSubtotalRow).height = 22;

  /* ======================================================
     SUBTOTAL: D + E + F
  ====================================================== */

  const rightSubtotalRow = rightRow;

  cover.mergeCells(`D${rightSubtotalRow}:E${rightSubtotalRow}`);

  const rightSubtotalLabel = cover.getCell(`D${rightSubtotalRow}`);
  rightSubtotalLabel.value = "SUB - TOTAL";
  rightSubtotalLabel.font = { bold: true, size: 9 };
  rightSubtotalLabel.alignment = {
    horizontal: "right",
    vertical: "middle"
  };
  styleCell(rightSubtotalLabel, {
    bold: true,
    align: "right"
  });

  const rightSubtotalAmount = cover.getCell(`F${rightSubtotalRow}`);
  rightSubtotalAmount.value =
    rightGroupTotal === 0 ? null : rightGroupTotal;
  rightSubtotalAmount.numFmt = moneyFormat;
  rightSubtotalAmount.font = { bold: true, size: 9 };
  rightSubtotalAmount.alignment = {
    horizontal: "center",
    vertical: "middle"
  };
  styleCell(rightSubtotalAmount, {
    bold: true,
    align: "center"
  });

  cover.getRow(rightSubtotalRow).height = 22;

  /* ======================================================
     GRAND TOTAL
     LABEL A:C
     AMOUNT D:F
  ====================================================== */

  const grandTotalValue = leftGroupTotal + rightGroupTotal;
  const grandTotalRow =
    Math.max(leftSubtotalRow, rightSubtotalRow) + 1;

  cover.mergeCells(`A${grandTotalRow}:C${grandTotalRow}`);
  cover.mergeCells(`D${grandTotalRow}:F${grandTotalRow}`);

  const grandTotalCell = cover.getCell(`A${grandTotalRow}`);
  grandTotalCell.value = "GRAND TOTAL / SAR. ONLY";
  grandTotalCell.font = {
    bold: true,
    size: 12
  };
  grandTotalCell.alignment = {
    horizontal: "left",
    vertical: "middle"
  };
  styleCell(grandTotalCell, { bold: true });

  const grandTotalAmount = cover.getCell(`D${grandTotalRow}`);
  grandTotalAmount.value =
    grandTotalValue === 0 ? null : grandTotalValue;
  grandTotalAmount.numFmt = moneyFormat;
  grandTotalAmount.font = {
    bold: true,
    size: 12
  };
  grandTotalAmount.alignment = {
    horizontal: "center",
    vertical: "middle"
  };
  styleCell(grandTotalAmount, {
    bold: true,
    align: "center"
  });

  cover.getRow(grandTotalRow).height = 28;

  /* ======================================================
     UNMAPPED CATEGORIES
  ====================================================== */

  let approvalStart = grandTotalRow + 2;

  if (unmatched.length) {
    cover.mergeCells(`A${approvalStart}:F${approvalStart}`);

    const unmatchedTitle = cover.getCell(`A${approvalStart}`);
    unmatchedTitle.value = "UNMAPPED CATEGORIES - PLEASE REVIEW";
    unmatchedTitle.font = {
      bold: true,
      color: { argb: red }
    };
    unmatchedTitle.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFE0E0" }
    };
    styleCell(unmatchedTitle, {
      bold: true,
      fill: "FFFFE0E0"
    });

    approvalStart++;

    cover.getCell(`A${approvalStart}`).value = "Category";
    cover.mergeCells(`B${approvalStart}:E${approvalStart}`);
    cover.getCell(`B${approvalStart}`).value = "Item Description";
    cover.getCell(`F${approvalStart}`).value = "Amount (SAR)";

    for (let c = 1; c <= 6; c++) {
      styleCell(cover.getRow(approvalStart).getCell(c), {
        bold: true,
        fill: grey
      });
    }

    unmatched.forEach((entry) => {
      approvalStart++;

      cover.getCell(`A${approvalStart}`).value = entry.category;

      cover.mergeCells(`B${approvalStart}:E${approvalStart}`);
      cover.getCell(`B${approvalStart}`).value = entry.description;

      const unmatchedAmount = cover.getCell(`F${approvalStart}`);
      unmatchedAmount.value = entry.amount === 0 ? null : entry.amount;
      unmatchedAmount.numFmt = moneyFormat;

      for (let c = 1; c <= 6; c++) {
        styleCell(cover.getRow(approvalStart).getCell(c));
      }

      unmatchedAmount.alignment = {
        horizontal: "center",
        vertical: "middle"
      };

      cover.getRow(approvalStart).height = 20;
    });

    approvalStart += 2;
  }

  /* ======================================================
     APPROVAL / SIGNATURE AREAS
  ====================================================== */

  function approvalBlock(
    row,
    leftTitle,
    rightTitle,
    leftRole,
    rightRole
  ) {
    cover.mergeCells(`A${row}:C${row}`);
    cover.mergeCells(`D${row}:F${row}`);

    setCoverCell(`A${row}`, leftTitle, { bold: true });
    setCoverCell(`D${row}`, rightTitle, { bold: true });

    cover.mergeCells(`A${row + 1}:B${row + 1}`);
    cover.mergeCells(`D${row + 1}:E${row + 1}`);

    setCoverCell(`A${row + 1}`, "", { fill: lightBlue });
    setCoverCell(`D${row + 1}`, "", { fill: lightBlue });

    setCoverCell(`C${row + 1}`, "Signature", {
      bold: true,
      align: "center"
    });

    setCoverCell(`F${row + 1}`, "Signature", {
      bold: true,
      align: "center"
    });

    setCoverCell(`A${row + 2}`, leftRole, { bold: true });

    cover.mergeCells(`D${row + 2}:F${row + 2}`);
    setCoverCell(`D${row + 2}`, rightRole, { bold: true });

    cover.getRow(row).height = 20;
    cover.getRow(row + 1).height = 28;
    cover.getRow(row + 2).height = 20;
  }

  approvalBlock(
    approvalStart,
    "Requested By:",
    "Reviewed By:",
    "Name",
    "Cost Control"
  );

  approvalStart += 3;

  approvalBlock(
    approvalStart,
    "Approved By:",
    "Approved By:",
    "Authorized Manager",
    "General Manager"
  );

  approvalStart += 3;

  cover.mergeCells(`A${approvalStart}:F${approvalStart}`);

  setCoverCell(
    `A${approvalStart}`,
    "FOR FINANCE DEPARTMENT USE ONLY",
    { bold: true, fill: grey }
  );

  approvalStart++;

  cover.mergeCells(`A${approvalStart}:C${approvalStart}`);
  cover.mergeCells(`D${approvalStart}:F${approvalStart}`);

  setCoverCell(`A${approvalStart}`, "Cost Center: __________");
  setCoverCell(`D${approvalStart}`, "Approved By: __________", {
    bold: true
  });

  approvalStart++;

  cover.mergeCells(`A${approvalStart}:C${approvalStart}`);
  cover.mergeCells(`D${approvalStart}:F${approvalStart}`);

  setCoverCell(`A${approvalStart}`, "Verified By: __________");
  setCoverCell(`D${approvalStart}`, "Financial Controller", {
    bold: true
  });

  approvalStart++;

  cover.mergeCells(`A${approvalStart}:C${approvalStart}`);
  cover.mergeCells(`D${approvalStart}:F${approvalStart}`);

  setCoverCell(`A${approvalStart}`, "Approved for Payment: __________");
  setCoverCell(`D${approvalStart}`, "Finance Approval: __________");

  approvalStart += 2;

  cover.mergeCells(`A${approvalStart}:F${approvalStart}`);

  const noteCell = cover.getCell(`A${approvalStart}`);
  noteCell.value =
    "NOTE TO EMPLOYEES:\nAN ORGANIZED SUMMARY MUST BE ATTACHED TO THE EXPENSE CLAIM UPON SUBMITTAL.";
  noteCell.font = {
    bold: true,
    size: 9,
    color: { argb: red }
  };
  noteCell.alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true
  };
  cover.getRow(approvalStart).height = 34;

  approvalStart++;

  cover.mergeCells(`A${approvalStart}:F${approvalStart}`);

  const footer = cover.getCell(`A${approvalStart}`);
  footer.value = "NU/DOC/FND/004 Issue 0";
  footer.font = {
    size: 8,
    color: { argb: black }
  };
  footer.alignment = {
    horizontal: "right",
    vertical: "middle"
  };

  /* ======================================================
     CONTROLLED COLUMN WIDTH / ROW HEIGHT
     NO EXTRA COLUMN
  ====================================================== */

  // Set fixed, controlled widths to avoid oversized columns.
  cover.getColumn(1).width = 11;
  cover.getColumn(2).width = 25;
  cover.getColumn(3).width = 12;
  cover.getColumn(4).width = 11;
  cover.getColumn(5).width = 25;
  cover.getColumn(6).width = 12;

  // Auto-fit rows to a controlled height.
  cover.eachRow({ includeEmpty: true }, (row) => {
    if (!row.height || row.height < 18) {
      row.height = 20;
    }
  });

  /* ======================================================
     OUTSIDE BORDER
     MEDIUM BLACK BORDER
  ====================================================== */

  const coverLastRow = approvalStart;

  // First, ensure regular thin borders on all used cells.
  for (let r = 1; r <= coverLastRow; r++) {
    for (let c = 1; c <= 6; c++) {
      const cell = cover.getRow(r).getCell(c);

      cell.border = {
        top: cell.border?.top || thinBorder.top,
        bottom: cell.border?.bottom || thinBorder.bottom,
        left: cell.border?.left || thinBorder.left,
        right: cell.border?.right || thinBorder.right
      };
    }
  }

  // Medium outside border: top and bottom.
  for (let c = 1; c <= 6; c++) {
    const topCell = cover.getRow(1).getCell(c);
    topCell.border = {
      ...topCell.border,
      top: mediumBorder.top
    };

    const bottomCell = cover.getRow(coverLastRow).getCell(c);
    bottomCell.border = {
      ...bottomCell.border,
      bottom: mediumBorder.bottom
    };
  }

  // Medium outside border: left and right.
  for (let r = 1; r <= coverLastRow; r++) {
    const leftCell = cover.getRow(r).getCell(1);
    leftCell.border = {
      ...leftCell.border,
      left: mediumBorder.left
    };

    const rightCell = cover.getRow(r).getCell(6);
    rightCell.border = {
      ...rightCell.border,
      right: mediumBorder.right
    };
  }

  /* ======================================================
     PRINT SETTINGS
  ====================================================== */

  cover.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    paperSize: 9,
    margins: {
      left: 0.2,
      right: 0.2,
      top: 0.25,
      bottom: 0.25,
      header: 0.1,
      footer: 0.1
    },
    printArea: `A1:F${coverLastRow}`
  };

  cover.views = [{ state: "normal" }];

  // ALL CELLS: WRAP TEXT OFF
cover.eachRow((row) => {
  row.eachCell((cell) => {
    cell.alignment = {
      ...cell.alignment,
      wrapText: false
    };
  });
});

  /* ======================================================
     DOWNLOAD WORKBOOK
  ====================================================== */

  const buffer = await workbook.xlsx.writeBuffer();

  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = safeFilename(claim.claimName) + ".xlsx";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =========================================================
   SAFE FILENAME
========================================================= */

function safeFilename(value) {
  return String(value || "Expense-Claim")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 90);
}
