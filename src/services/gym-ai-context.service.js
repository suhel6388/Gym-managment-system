import { prisma } from "../db.js";

export async function fetchGymSnapshot(gymId) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 1. Gym Profile
  const gym = await prisma.gym.findUnique({
    where: { id: gymId },
    select: { name: true, phone: true },
  });

  // 2. Today's Payments
  const paymentsToday = await prisma.payment.findMany({
    where: {
      gymId,
      paidAt: { gte: startOfToday, lte: endOfToday },
    },
    include: {
      member: { select: { name: true } },
    },
    orderBy: { paidAt: "desc" },
  });

  const todayPaymentTotal = paymentsToday.reduce((sum, p) => sum + (p.amount || 0), 0);
  const todayPaymentItems = paymentsToday.map((p) => ({
    memberName: p.member?.name || "Unknown",
    amount: p.amount || 0,
    mode: p.paymentMode,
    receipt: p.receiptNumber,
  }));

  // 3. Today's Joining Members
  const membersToday = await prisma.member.findMany({
    where: {
      gymId,
      joinedAt: { gte: startOfToday, lte: endOfToday },
      archivedAt: null,
    },
    select: {
      name: true,
      phone: true,
      timing: true,
      memberCode: true,
    },
    orderBy: { joinedAt: "desc" },
  });

  // 4. Today's Expenses
  const expensesToday = await prisma.expense.findMany({
    where: {
      gymId,
      expenseDate: { gte: startOfToday, lte: endOfToday },
    },
    select: {
      name: true,
      category: true,
      amount: true,
    },
    orderBy: { expenseDate: "desc" },
  });

  const todayExpenseTotal = expensesToday.reduce((sum, e) => sum + (e.amount || 0), 0);

  // 5. Overall statistics
  const [
    totalMembers,
    activeMemberships,
    expiringNext7Days,
    monthPayments,
    monthExpenses,
  ] = await Promise.all([
    prisma.member.count({
      where: { gymId, archivedAt: null },
    }),
    prisma.membership.count({
      where: { gymId, status: "ACTIVE" },
    }),
    prisma.membership.count({
      where: {
        gymId,
        status: "ACTIVE",
        endDate: { gte: now, lte: sevenDaysLater },
      },
    }),
    prisma.payment.aggregate({
      where: {
        gymId,
        paidAt: { gte: startOfMonth },
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: {
        gymId,
        expenseDate: { gte: startOfMonth },
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    gymName: gym?.name || "DarkGold Gym",
    gymPhone: gym?.phone || "N/A",
    todayDateStr: now.toLocaleDateString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    todayPayments: {
      count: paymentsToday.length,
      totalAmount: todayPaymentTotal,
      items: todayPaymentItems,
    },
    todayMembers: {
      count: membersToday.length,
      items: membersToday.map((m) => ({
        name: m.name,
        phone: m.phone,
        timing: m.timing,
        code: m.memberCode,
      })),
    },
    todayExpenses: {
      count: expensesToday.length,
      totalAmount: todayExpenseTotal,
      items: expensesToday.map((e) => ({
        name: e.name,
        category: e.category,
        amount: e.amount,
      })),
    },
    overall: {
      totalMembers,
      activeMemberships,
      expiringNext7Days,
      monthCollection: monthPayments._sum.amount || 0,
      monthExpenses: monthExpenses._sum.amount || 0,
    },
  };
}

export function buildSystemPrompt(snapshot) {
  const paymentList = snapshot.todayPayments.items.length > 0
    ? snapshot.todayPayments.items
        .map((p) => `- ${p.memberName}: ₹${p.amount.toLocaleString("en-IN")} via ${p.mode} (Receipt #${p.receipt})`)
        .join("\n")
    : "No payments recorded today yet.";

  const memberList = snapshot.todayMembers.items.length > 0
    ? snapshot.todayMembers.items
        .map((m) => `- ${m.name} (${m.code}) | Phone: ${m.phone} | Shift: ${m.timing}`)
        .join("\n")
    : "No new members joined today yet.";

  const expenseList = snapshot.todayExpenses.items.length > 0
    ? snapshot.todayExpenses.items
        .map((e) => `- ${e.name} [${e.category}]: ₹${e.amount.toLocaleString("en-IN")}`)
        .join("\n")
    : "No expenses recorded today.";

  return `You are the official AI Gym Assistant for "${snapshot.gymName}".
You have real-time live access to the database records for this gym as of ${snapshot.todayDateStr}.

=== LIVE DATABASE SNAPSHOT FOR ${snapshot.gymName.toUpperCase()} ===
Date: ${snapshot.todayDateStr}

1. TODAY'S FEE PAYMENTS:
- Total Transactions: ${snapshot.todayPayments.count}
- Total Amount Collected: ₹${snapshot.todayPayments.totalAmount.toLocaleString("en-IN")}
- Payments Details:
${paymentList}

2. TODAY'S NEW JOINING MEMBERS:
- Total New Members: ${snapshot.todayMembers.count}
- Member Details:
${memberList}

3. TODAY'S EXPENSES:
- Total Expense Records: ${snapshot.todayExpenses.count}
- Total Expense Amount: ₹${snapshot.todayExpenses.totalAmount.toLocaleString("en-IN")}
- Expense Details:
${expenseList}

4. OVERALL GYM OVERVIEW:
- Total Registered Members: ${snapshot.overall.totalMembers}
- Currently Active Memberships: ${snapshot.overall.activeMemberships}
- Memberships Expiring in the Next 7 Days: ${snapshot.overall.expiringNext7Days}
- This Month's Total Collections: ₹${snapshot.overall.monthCollection.toLocaleString("en-IN")}
- This Month's Total Expenses: ₹${snapshot.overall.monthExpenses.toLocaleString("en-IN")}

=== STRICT SECURITY & TOPIC RULES ===
1. You may ONLY answer questions concerning this gym's operations, fee payments, joining members, expenses, attendance, renewals, and finances.
2. If the user asks general knowledge, coding, politics, essays, recipes, or anything NOT related to this gym, politely decline with:
   "I am your dedicated Gym Management AI. I can only assist with queries related to ${snapshot.gymName}'s fee payments, members, expenses, renewals, and reports."
3. Format currency clearly in Indian Rupees (₹). Use bullet points and bold formatting for readability.
4. Keep responses concise, direct, professional, and friendly.`;
}

/**
 * Intelligent deterministic answer generator when Gemini API key is not configured or in fallback mode.
 */
export function generateDeterministicAnswer(question, snapshot) {
  const q = (question || "").toLowerCase();

  // Payment / Fee queries
  if (q.includes("payment") || q.includes("fee") || q.includes("collection") || q.includes("revenue")) {
    const { count, totalAmount, items } = snapshot.todayPayments;
    let text = `💳 **Today's Fee Payments Report (${snapshot.todayDateStr})**\n\n`;
    text += `- **Total Collections Today:** ₹${totalAmount.toLocaleString("en-IN")}\n`;
    text += `- **Total Transactions:** ${count}\n\n`;
    if (items.length > 0) {
      text += `**Breakdown:**\n`;
      items.forEach((p, i) => {
        text += `${i + 1}. **${p.memberName}** — ₹${p.amount.toLocaleString("en-IN")} via ${p.mode} (Receipt #${p.receipt})\n`;
      });
    } else {
      text += `No fee payments have been recorded yet today.\n`;
    }
    return text;
  }

  // Member / Joining queries
  if (q.includes("member") || q.includes("join") || q.includes("new admission") || q.includes("admission")) {
    const { count, items } = snapshot.todayMembers;
    let text = `👤 **Today's New Joining Members (${snapshot.todayDateStr})**\n\n`;
    text += `- **New Members Joined Today:** ${count}\n`;
    text += `- **Total Active Members:** ${snapshot.overall.activeMemberships}\n\n`;
    if (items.length > 0) {
      text += `**New Members:**\n`;
      items.forEach((m, i) => {
        text += `${i + 1}. **${m.name}** (${m.code}) — Phone: ${m.phone} | Shift: ${m.timing}\n`;
      });
    } else {
      text += `No new members have joined yet today.\n`;
    }
    return text;
  }

  // Expense queries
  if (q.includes("expense") || q.includes("spent") || q.includes("kharcha") || q.includes("cost")) {
    const { count, totalAmount, items } = snapshot.todayExpenses;
    let text = `📉 **Today's Expense Report (${snapshot.todayDateStr})**\n\n`;
    text += `- **Total Expenses Today:** ₹${totalAmount.toLocaleString("en-IN")}\n`;
    text += `- **Total Expense Entries:** ${count}\n\n`;
    if (items.length > 0) {
      text += `**Itemized Expenses:**\n`;
      items.forEach((e, i) => {
        text += `${i + 1}. **${e.name}** [${e.category}] — ₹${e.amount.toLocaleString("en-IN")}\n`;
      });
    } else {
      text += `No expenses have been recorded yet today.\n`;
    }
    return text;
  }

  // Renewal / Expiry queries
  if (q.includes("expir") || q.includes("renew") || q.includes("due")) {
    let text = `⏰ **Membership Renewals & Expiry Status**\n\n`;
    text += `- **Memberships Expiring in Next 7 Days:** ${snapshot.overall.expiringNext7Days}\n`;
    text += `- **Total Active Memberships:** ${snapshot.overall.activeMemberships}\n`;
    text += `\nYou can review expiring members in the Memberships tab to send WhatsApp renewal reminders.`;
    return text;
  }

  // Default overview
  return `📊 **Gym Overview for ${snapshot.gymName} (${snapshot.todayDateStr})**\n\n` +
    `- **Today's Fee Collection:** ₹${snapshot.todayPayments.totalAmount.toLocaleString("en-IN")} (${snapshot.todayPayments.count} payments)\n` +
    `- **Today's New Members:** ${snapshot.todayMembers.count} joined\n` +
    `- **Today's Expenses:** ₹${snapshot.todayExpenses.totalAmount.toLocaleString("en-IN")} (${snapshot.todayExpenses.count} entries)\n` +
    `- **Active Memberships:** ${snapshot.overall.activeMemberships}\n` +
    `- **Expiring within 7 Days:** ${snapshot.overall.expiringNext7Days}\n` +
    `- **Month Collection:** ₹${snapshot.overall.monthCollection.toLocaleString("en-IN")}\n\n` +
    `Ask me specific questions like *"today fee payment"*, *"today joining member"*, or *"today expense report"*.`;
}
