import CityApp from './CityApp'

// The 3D city is the primary view. The 2D crime heatmap prototype lives on its own
// page (crime.html) while both are built in parallel.
function App() {
  return <CityApp />
}

export default App
