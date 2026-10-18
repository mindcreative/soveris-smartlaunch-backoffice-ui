import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { DataTable } from './DataTable'
it('names sort controls and exposes sort direction without relying on the icon', () => {
  render(<DataTable caption="Records" data={[{ name: 'B' }, { name: 'A' }]} columns={[{ key: 'name', label: 'Name', sortable: true }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
  expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
  expect(screen.getAllByRole('cell').map(cell => cell.textContent)).toEqual(['A', 'B'])
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
  expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending')
})
it('sorts once from header padding and once from its keyboard button', () => {
  render(<DataTable data={[{ name: 'B' }, { name: 'A' }]} columns={[{ key: 'name', label: 'Name', sortable: true }]} />)
  fireEvent.click(screen.getByRole('columnheader'))
  expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
  fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
  expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending')
})
