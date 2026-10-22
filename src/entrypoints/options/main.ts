import { mount } from 'svelte';
import '../../ui/styles/page.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
