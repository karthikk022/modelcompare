import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Navbar from '../Navbar'
import ErrorBoundary from '../ErrorBoundary'

describe('Navbar', () => {
  it('renders brand name', () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>)
    expect(screen.getByText('ModelCompare')).toBeInTheDocument()
  })

  it('renders all navigation links', () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>)
    expect(screen.getByText('Models')).toBeInTheDocument()
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('Discover')).toBeInTheDocument()
    expect(screen.getByText('Prompts')).toBeInTheDocument()
    expect(screen.getByText('Compare')).toBeInTheDocument()
  })
})

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(<ErrorBoundary><div>child content</div></ErrorBoundary>)
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('renders fallback on error', () => {
    const Thrower = () => { throw new Error('boom') }
    render(<ErrorBoundary><Thrower /></ErrorBoundary>)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('renders custom fallback when provided', () => {
    const Thrower = () => { throw new Error('boom') }
    render(<ErrorBoundary fallback={<div>custom error UI</div>}><Thrower /></ErrorBoundary>)
    expect(screen.getByText('custom error UI')).toBeInTheDocument()
  })

  it('renders try again button on error', async () => {
    const Thrower = () => { throw new Error('boom') }
    render(<ErrorBoundary><Thrower /></ErrorBoundary>)
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })
})
