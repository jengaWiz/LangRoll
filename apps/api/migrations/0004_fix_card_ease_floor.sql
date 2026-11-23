-- ease is a 4-byte real, which stores 1.3 as 1.2999999523. The check compared it with the exact
-- 1.3, so a word forgotten often enough to reach the scheduler's floor failed it, and every later
-- upload from that learner was refused. Compare in the column's own type instead.
alter table app.cards drop constraint cards_ease_check;
alter table app.cards add constraint cards_ease_check check (ease between 1.3::real and 3.0::real);
