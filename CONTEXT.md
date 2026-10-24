# Shared terminology

| Term | Meaning |
| --- | --- |
| Budget space | The private or shared boundary for accounts, categories, plans, transactions, and access. The proposed model is `BudgetSpace`. |
| Private budget | A user's personal budget space. Only its owner can access its private data. |
| Shared budget | A budget space with at most two active members. Both partners have equal control. |
| Partner | The other active member of a shared budget. An invitation alone does not make a person a member. |
| Membership | A user's access relationship with a budget space. It records active or left status and join and leave dates. |
| Account | A checking, savings, or credit card account. It belongs to one budget space at a time. |
| Bank connection | The link between a connecting user and a bank institution. It has a connection status and a last successful sync time. |
| Monthly plan | A budget space's plan for one calendar month. It contains expected income, category limits, a savings target, and funding allocations. The proposed model is `MonthlyBudget`. |
| Expected income | Planned take-home income for the month. It is separate from actual income. |
| Actual income | Income recorded from transactions. Transfers and shared contributions are not earned income. |
| Category | A budget space's spending classification, such as groceries or housing. |
| Fund | Money set aside for a repeating payment or a one-time savings goal, such as yearly insurance or a new vehicle. Funds belong to a budget space. The Funds tab shows the monthly amount needed for each fund. |
| Funds category | An automatic, read-only monthly budget category shown when funds are set up. Its amount is the total monthly amount needed for the budget space's funds. Saving the budget reserves those amounts; saving it again replaces them. |
| Fund balance | A fund's opening amount plus contributions from saved monthly budgets, minus posted purchases linked to the fund. Linked refunds restore the balance. It tracks reserved money, not a bank account balance. |
| Category limit | The planned spending amount for one category in one month. The proposed record is `CategoryAllocation`. |
| Category spending | Counted spending for a category. Refunds reduce it. Pending charges are shown separately from finalized totals. |
| Category balance | Category limit minus counted category spending. A negative balance means overspending. |
| Savings target | One planned savings amount for a budget space and month. It is not a bank balance or a money transfer. |
| Actual savings | Actual income plus incoming personal allocations, minus outgoing personal allocations and actual spending. Legacy contributions apply to historical months. This is a monthly result. |
| Personal allocation | A monthly amount assigned from a shared budget to one member's private budget. It reduces shared funding and adds equal private funding at once, without a bank transfer. Both partners can see the amount; private spending and transactions remain owner-only. |
| Shared contribution | Legacy funding from a private budget to a shared budget, kept for historical records. Planned amounts and matched actual transfers are separate. |
| Transfer | Money moved between accounts. It is neither a purchase nor earned income. Personal allocations change budget funding without a transfer; legacy shared contributions used matched transfers. |
| Split | Parts of one transaction assigned to categories. The parts must total the transaction amount. |
| Available leftovers | Actual monthly savings after subtracting fund reservations and adding back payments covered by funds, above the source month's general savings target, with a minimum of zero. Existing carry-forward allocations reduce the amount still available to assign. |
| Carry-forward | An explicit allocation from a source month's savings above its target to the next month's categories or savings target. It is a separate funding source. |
| Reserved funds | Money allocated from a source month for a destination month. It must stay separate from retained savings. |
| Retained savings | The part of a month's savings that is not reserved for a later month. Reserving funds does not change the source month's actual savings result. |
| Monthly review | The process of checking a month's results, correcting classifications, and assigning leftovers. |
| Pending transaction | A bank charge that is not yet posted. Show it separately. |
| Posted transaction | A bank transaction used in finalized totals. It replaces its pending entry without counting both. |
| Manual transaction | An optional transaction entered by a user. It supports create, read, update, and delete operations. |
| Stale data | Imported data kept after a sync failure. Show the failure and last successful sync time. |
| Recurring-charge suggestion | An estimated recurring charge with an amount and expected date. The user can confirm or dismiss it. The proposed model is `RecurringBill`. |
