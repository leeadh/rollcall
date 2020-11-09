import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-contentsidenav',
  templateUrl: './contentsidenav.component.html',
  styleUrls: ['./contentsidenav.component.scss']
})
export class ContentsidenavComponent implements OnInit {

  constructor(private router: Router) { }

  ngOnInit(): void {
  }

}
