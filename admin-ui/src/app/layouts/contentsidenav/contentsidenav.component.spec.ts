import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ContentsidenavComponent } from './contentsidenav.component';

describe('ContentsidenavComponent', () => {
  let component: ContentsidenavComponent;
  let fixture: ComponentFixture<ContentsidenavComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ContentsidenavComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ContentsidenavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
