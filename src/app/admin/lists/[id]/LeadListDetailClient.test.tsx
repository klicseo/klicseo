import { test, expect } from "vitest";
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

if (typeof window !== 'undefined' && !window.PointerEvent) {
  // @ts-ignore
  window.PointerEvent = window.MouseEvent;
}
if (typeof Element !== 'undefined') {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Mock actions used by the component
vi.mock('../actions', () => {
  return {
    searchLeadsForListAction: async (q: string) => {
      return [
        { id: 'a', name: 'Alice', phone: '111', service: 'Service A', service_option: null, add_on_labels: null, vehicle_type: null, car_brand: null, car_model: null, car_number: null, status: 'new' },
        { id: 'b', name: 'Bob', phone: '222', service: 'Service B', service_option: null, add_on_labels: null, vehicle_type: null, car_brand: null, car_model: null, car_number: null, status: 'new' },
      ];
    },
    addLeadsToListAction: async () => ({ ok: true }),
    removeLeadFromListAction: async () => ({ ok: true }),
    deleteLeadListAction: async () => {},
  };
});

import LeadListDetailClient from './LeadListDetailClient';

const fakeList = { id: 'list1', name: 'My List', assigned_admin_user: { name: 'Admin' } };

test('pointer drag selects range on touch', async () => {
  const { container } = render(<LeadListDetailClient list={fakeList as any} initialLeads={[]} isSuperAdmin={true} canManage={true} />);

  // type a search and click Search
  const input = screen.getByPlaceholderText(/Search leads/i);
  await userEvent.type(input, 'Alice');
  const searchBtn = screen.getByRole('button', { name: /Search/i });
  await userEvent.click(searchBtn);

  // wait for results
  await waitFor(() => screen.getByText('Alice'));

  // find first and second result buttons by data-index attribute
  const btnA = document.querySelector('button[data-index="0"]') as HTMLElement;
  const btnB = document.querySelector('button[data-index="1"]') as HTMLElement;
  expect(btnA).toBeTruthy();
  expect(btnB).toBeTruthy();

  // simulate pointer down on first, move to second, and up
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = (x: number, y: number) => {
    if (x === 2 && y === 2) return btnB;
    return null;
  };

  fireEvent.pointerDown(btnA, { pointerId: 1, clientX: 0, clientY: 0 });
  // move to a point inside btnB
  const rect = btnB.getBoundingClientRect();
  fireEvent.pointerMove(btnA, { clientX: rect.left + 2, clientY: rect.top + 2 });
  fireEvent.pointerUp(btnA, { pointerId: 1 });

  // restore
  document.elementFromPoint = originalElementFromPoint;

  // check that selection summary appears with 2 leads selected
  await waitFor(() => expect(container.textContent).toContain("2 leads selected"));
});

test('handles pagination correctly when 150 leads are passed', async () => {
  const mock150Leads = Array.from({ length: 150 }, (_, i) => ({
    id: `lead-${i + 1}`,
    name: `Lead ${i + 1}`,
    phone: `9876543${String(i).padStart(3, "0")}`,
    service: "Foam Wash",
    service_option: null,
    add_on_labels: null,
    vehicle_type: null,
    car_brand: "Hyundai",
    car_model: "Creta",
    car_number: null,
    status: "new" as const,
  }));

  const { container } = render(
    <LeadListDetailClient
      list={{ ...fakeList, lead_count: 150 } as any}
      initialLeads={mock150Leads}
      isSuperAdmin={true} canManage={true}
    />
  );

  // Checks that header displays 150 leads total
  expect(container.textContent).toContain("150 leads");
  // Checks that pagination displays Page 1 of 3 and Showing 1–50 of 150 leads
  expect(container.textContent).toContain("Page 1 of 3");
  expect(container.textContent).toContain("Showing 1–50 of 150 leads");

  // Click Next ›
  const nextBtn = screen.getByRole("button", { name: /Next ›/i });
  await userEvent.click(nextBtn);

  expect(container.textContent).toContain("Page 2 of 3");
  expect(container.textContent).toContain("Showing 51–100 of 150 leads");
  expect(container.textContent).toContain("Lead 51");
});


const searchableLead = {
  id: 'search-one', name: "Alice O'Neil", phone: '+91 98765 43210', car_number: 'TN 09 AB 1234',
  service: 'Foam Wash', service_option: null, add_on_labels: null, vehicle_type: null,
  car_brand: 'Hyundai', car_model: 'Creta', status: 'new' as const,
};

test('staff can search their list by formatted car number and see a clear empty result', async () => {
  const { container } = render(<LeadListDetailClient list={fakeList as any} initialLeads={[searchableLead]} isSuperAdmin={false} canManage={false} />);
  const input = screen.getByRole('searchbox', { name: 'Search this list' });
  await userEvent.type(input, 'tn09ab1234');
  expect(container.textContent).toContain("Alice O'Neil");
  await userEvent.clear(input);
  await userEvent.type(input, 'no such customer');
  expect(container.textContent).not.toContain("Alice O'Neil");
  expect(container.textContent).toContain('No leads match');
});

test('view-only staff do not see mutation controls and refreshed server data replaces stale rows', () => {
  const { container, rerender } = render(<LeadListDetailClient list={fakeList as any} initialLeads={[searchableLead]} isSuperAdmin={false} canManage={false} />);
  expect(screen.queryByText('Add Leads to This List')).toBeNull();
  expect(screen.queryByTitle('Remove from list')).toBeNull();
  expect(screen.queryByText('Upload Leads')).toBeNull();
  rerender(<LeadListDetailClient list={fakeList as any} initialLeads={[]} isSuperAdmin={false} canManage={false} />);
  expect(container.textContent).not.toContain("Alice O'Neil");
});
